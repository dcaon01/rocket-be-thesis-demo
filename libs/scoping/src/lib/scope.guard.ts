import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { AccountType } from './account-type.enum';
import { RequestScope } from './scope.types';

/** Cognito group names reserved for account types (mutually exclusive). */
const ACCOUNT_TYPE_GROUPS = Object.values(AccountType) as string[];

/** JWT claim holding the reseller code of reseller users (Cognito custom attribute). */
const RESELLER_CODE_CLAIM = 'custom:resellerCode';

/** Minimal JWT payload shape consumed by the guard. */
type TokenPayload = Record<string, unknown> & { sub?: string };

/**
 * Guard populating `request.scope` from the JWT in the Authorization header.
 * The scope is entirely self-contained in the token: account type from the
 * `cognito:groups` claim, reseller code from the `custom:resellerCode` custom
 * attribute (natively present in the ID token) — no database lookup.
 *
 * Token verification: when COGNITO_USER_POOL_ID is configured the signature is
 * verified with aws-jwt-verify (defense in depth — API Gateway already
 * validates it upstream); in development without a pool id the payload is
 * decoded without verification.
 *
 * Applied per-controller, NEVER globally: webhook and SQS routes are
 * machine-to-machine and must not require a user JWT.
 */
@Injectable()
export class ScopeGuard implements CanActivate {
  /** Logger instance for ScopeGuard. */
  private readonly _logger = new Logger(ScopeGuard.name);

  /** Cached verifier instance (created on first use). */
  private _verifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;

  /**
   * Constructor for ScopeGuard.
   * @param _configService the config service used to resolve the Cognito pool settings.
   */
  constructor(private readonly _configService: ConfigService) { }

  /**
   * Extracts and validates the bearer token, then populates `request.scope`.
   * @param context the execution context of the request.
   * @returns true when the scope was populated successfully.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers?: Record<string, string | undefined>;
      scope?: RequestScope;
    }>();

    const authHeader = request.headers?.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token.');
    }
    const token = authHeader.slice('Bearer '.length);

    const payload = await this._resolvePayload(token);

    const rawGroups: unknown = payload['cognito:groups'];
    const groups: string[] = Array.isArray(rawGroups)
      ? rawGroups.filter((group): group is string => typeof group === 'string')
      : [];
    const accountType = groups.includes(AccountType.RESELLER)
      ? AccountType.RESELLER
      : AccountType.COLLABORATOR;
    const rawResellerCode = payload[RESELLER_CODE_CLAIM];
    const resellerCode = typeof rawResellerCode === 'string' && rawResellerCode !== ''
      ? rawResellerCode
      : undefined;

    if (accountType === AccountType.RESELLER && !resellerCode) {
      throw new ForbiddenException(
        `Reseller user without the ${RESELLER_CODE_CLAIM} claim: the token must carry the reseller code (ID token expected).`,
      );
    }

    request.scope = {
      sub: String(payload.sub ?? ''),
      accountType,
      resellerCode: accountType === AccountType.RESELLER ? resellerCode : undefined,
      roles: groups.filter(group => !ACCOUNT_TYPE_GROUPS.includes(group)),
    };
    return true;
  }

  /**
   * Resolves the token payload: full signature verification when the pool id
   * is configured, decode-only fallback in development.
   * @param token the raw JWT.
   * @returns the token payload.
   */
  private async _resolvePayload(token: string): Promise<TokenPayload> {
    const userPoolId = this._configService.get<string>('COGNITO_USER_POOL_ID');

    if (userPoolId) {
      if (!this._verifier) {
        this._verifier = CognitoJwtVerifier.create({
          userPoolId,
          tokenUse: null, // accept both id and access tokens
          clientId: this._configService.get<string>('COGNITO_CLIENT_ID') ?? null,
        });
      }
      try {
        return await this._verifier.verify(token) as TokenPayload;
      } catch (error) {
        this._logger.warn('JWT verification failed', error);
        throw new UnauthorizedException('Invalid or expired token.');
      }
    }

    if (this._configService.get<string>('NODE_ENV') !== 'development') {
      throw new UnauthorizedException('COGNITO_USER_POOL_ID is not configured: cannot verify the token.');
    }

    // Development fallback: decode without verifying (API Gateway validates upstream).
    try {
      const payloadSegment = token.split('.')[1];
      return JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8')) as TokenPayload;
    } catch {
      throw new UnauthorizedException('Malformed token.');
    }
  }
}
