import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from "@nestjs/common";
import { LazyModuleLoader, Reflector } from "@nestjs/core";
import { from, Observable, switchMap } from "rxjs";
import { AccountType, RequestScope } from "@rocket-be/scoping";
import { ALLOW_BLOCKED_RESELLER } from "../commons/scoping/allow-blocked-reseller.decorator";
import { AuthorizationException } from "../errors/exception-types";
import type { ResellersService } from "../modules/resellers/lazy-resellers/services/resellers.service";

/** How long a reseller found allowed is trusted before it is checked again; a blocked one is checked every time. */
const ALLOWED_CACHE_MS = 30 * 1000;

/**
 * Interceptor that refuses the requests of the users of a blocked reseller: without a contract in force, or with an
 * invoice still unpaid on the fifteenth day of its dunning. The blocking screen of the frontend is a convenience;
 * this is the protection. Only the handlers marked with `@AllowBlockedReseller()` stay open, the ones needed to read
 * and lift the block. Keus collaborators and the internal paths, which carry no reseller scope, pass untouched.
 */
@Injectable()
export class ResellerAccessInterceptor implements NestInterceptor {
  /** Logger instance for ResellerAccessInterceptor. */
  private readonly _logger = new Logger(ResellerAccessInterceptor.name);

  /** Lazy-loaded resellers service. */
  private _resellersService: ResellersService | null = null;

  /** Resellers found allowed recently, by code, with when they were checked. */
  private readonly _allowed = new Map<string, number>();

  /**
   * Constructor for ResellerAccessInterceptor.
   * @param _reflector the reflector reading the marks of the handlers.
   * @param _lazyModuleLoader the NX lazy module loader used to resolve the resellers service on demand.
   */
  constructor(
    private readonly _reflector: Reflector,
    private readonly _lazyModuleLoader: LazyModuleLoader,
  ) { }

  /**
   * Lazy loads the ResellersService from its module.
   * @returns a Promise resolving to the ResellersService instance.
   */
  private async _loadResellersService(): Promise<ResellersService> {
    if (!this._resellersService) {
      const { ResellersLazyModule } = await import("../modules/resellers/lazy-resellers/resellers-lazy.module");
      const moduleRef = await this._lazyModuleLoader.load(() => ResellersLazyModule);
      const { ResellersService } = await import("../modules/resellers/lazy-resellers/services/resellers.service");
      this._resellersService = moduleRef.get<ResellersService>(ResellersService);
    }
    return this._resellersService;
  }

  /**
   * Lets the request through, unless it comes from a user of a blocked reseller and its handler is not marked open.
   * @param context the execution context of the request.
   * @param next the handler of the request.
   * @returns the response of the handler.
   * @throws AuthorizationException when the reseller of the user is blocked.
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const scope = context.switchToHttp().getRequest<{ scope?: RequestScope }>().scope;
    const resellerCode = scope?.accountType === AccountType.RESELLER ? scope.resellerCode : undefined;
    const open = this._reflector.getAllAndOverride<boolean>(ALLOW_BLOCKED_RESELLER, [context.getHandler(), context.getClass()]);
    if (!resellerCode || open) {
      return next.handle();
    }

    return from(this._assertAllowed(resellerCode)).pipe(switchMap(() => next.handle()));
  }

  /**
   * Checks that a reseller can work, trusting a recent positive check.
   * @param resellerCode the code of the reseller of the user.
   * @throws AuthorizationException when the reseller is blocked.
   */
  private async _assertAllowed(resellerCode: string): Promise<void> {
    const checkedAt = this._allowed.get(resellerCode);
    if (checkedAt && Date.now() - checkedAt < ALLOWED_CACHE_MS) {
      return;
    }

    const resellersService = await this._loadResellersService();
    if (await resellersService.isAccessBlocked(resellerCode)) {
      this._allowed.delete(resellerCode);
      this._logger.warn(`Request of a user of reseller ${resellerCode} refused: the reseller is blocked.`);
      throw new AuthorizationException(`Reseller ${resellerCode} is blocked: it has no contract in force or an invoice still unpaid.`, { code: "RESELLER_ACCESS_BLOCKED" });
    }
    this._allowed.set(resellerCode, Date.now());
  }
}
