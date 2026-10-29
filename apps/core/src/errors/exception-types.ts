import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Interface for standardized error responses
 * Provides a consistent structure for all API error responses
 */
export interface ErrorResponse {
  /** HTTP status code */
  statusCode: number;
  /** Human-readable error message */
  message: string;
  /** Error type name corresponding to the HTTP status */
  error: string;
  /** ISO timestamp when the error occurred */
  timestamp: string;
  /** Request path that caused the error */
  path?: string;
  /** Unique identifier to correlate logs and errors */
  correlationId?: string;
  /** Additional context-specific error details */
  details?: Record<string, unknown>;
}

/**
 * Base class for all application exceptions
 * Extends NestJS HttpException with additional metadata and consistent formatting
 */
export class AppException extends HttpException {
  private readonly timestamp: string;
  private readonly details?: Record<string, unknown>;
  private readonly correlationId?: string;

  /**
   * Creates a new AppException
   * @param message Human-readable error message
   * @param status HTTP status code
   * @param details Additional error details (optional)
   * @param correlationId Unique identifier to correlate logs (optional)
   */
  constructor(
    message: string,
    status: HttpStatus,
    details?: unknown,
    correlationId?: string
  ) {
    super(
      {
        message,
        statusCode: status,
        error: HttpStatus[status],
      },
      status
    );
    this.timestamp = new Date().toISOString();
    this.details = AppException._normalizeDetails(details);
    this.correlationId = correlationId;
  }

  /** Normalizes arbitrary details into a Record<string, unknown>. */
  private static _normalizeDetails(details: unknown): Record<string, unknown> | undefined {
    if (details == null) return undefined;
    if (details instanceof Error) return { name: details.name, message: details.message };
    if (typeof details === 'object' && !Array.isArray(details)) return details as Record<string, unknown>;
    return { value: details };
  }

  /**
   * Gets all exception properties formatted as an ErrorResponse
   * @returns Standardized error response object
   */
  getResponse(): ErrorResponse {
    const baseResponse = super.getResponse() as Record<string, unknown>;
    return {
      statusCode: baseResponse.statusCode as number,
      message: baseResponse.message as string,
      error: baseResponse.error as string,
      timestamp: this.timestamp,
      details: this.details,
      correlationId: this.correlationId,
    };
  }
}

/**
 * Exception for when a requested entity cannot be found
 * Maps to HTTP 404 Not Found
 */
export class EntityNotFoundException extends AppException {
  /**
   * Creates a new EntityNotFoundException
   * @param entityName Name of the entity type (e.g., "Admin", "User")
   * @param identifier ID or other unique identifier that was not found
   * @param correlationId Unique identifier to correlate logs (optional)
   */
  constructor(
    entityName: string,
    identifier: string | number,
    correlationId?: string
  ) {
    super(
      `${entityName} with identifier ${identifier} not found.`,
      HttpStatus.NOT_FOUND,
      { entityName, identifier },
      correlationId
    );
  }
}

/**
 * Exception for input validation failures
 * Maps to HTTP 400 Bad Request
 */
export class ValidationException extends AppException {
  /**
   * Creates a new ValidationException
   * @param message Human-readable error message
   * @param validationErrors List of specific validation errors
   * @param correlationId Unique identifier to correlate logs (optional)
   */
  constructor(
    message: string,
    validationErrors: unknown[],
    correlationId?: string
  ) {
    super(
      message || 'Validation error',
      HttpStatus.BAD_REQUEST,
      { validationErrors },
      correlationId
    );
  }
}

/**
 * Exception for database-related errors
 * Maps to HTTP 500 Internal Server Error
 */
export class DatabaseException extends AppException {
  /**
   * Creates a new DatabaseException
   * @param message Human-readable error message
   * @param dbError Original database error (will be sanitized)
   * @param correlationId Unique identifier to correlate logs (optional)
   */
  constructor(
    message: string,
    dbError: unknown,
    correlationId?: string
  ) {
    // Sanitize the database error to remove sensitive information
    const dbErrorTyped = dbError as { name?: string; code?: string; message?: string } | null | undefined;
    const sanitizedError = dbErrorTyped ? {
      name: dbErrorTyped.name,
      code: dbErrorTyped.code,
      message: dbErrorTyped.message
    } : undefined;

    super(
      message || 'Database error',
      HttpStatus.INTERNAL_SERVER_ERROR,
      sanitizedError,
      correlationId
    );
  }
}

/**
 * Exception for authorization failures (user authenticated but not allowed)
 * Maps to HTTP 403 Forbidden
 */
export class AuthorizationException extends AppException {
  /**
   * Creates a new AuthorizationException
   * @param message Human-readable error message
   * @param details Additional context about the authorization failure
   * @param correlationId Unique identifier to correlate logs (optional)
   */
  constructor(
    message: string,
    details?: unknown,
    correlationId?: string
  ) {
    super(
      message || 'Not authorized to perform this operation',
      HttpStatus.FORBIDDEN,
      details,
      correlationId
    );
  }
}

/**
 * Exception for authentication failures
 * Maps to HTTP 401 Unauthorized
 */
export class AuthenticationException extends AppException {
  /**
   * Creates a new AuthenticationException
   * @param message Human-readable error message
   * @param details Additional context about the authentication failure
   * @param correlationId Unique identifier to correlate logs (optional)
   */
  constructor(
    message: string,
    details?: unknown,
    correlationId?: string
  ) {
    super(
      message || 'Authentication failed',
      HttpStatus.UNAUTHORIZED,
      details,
      correlationId
    );
  }
}

/**
 * Exception for duplicate email errors
 * Maps to HTTP 409 Conflict
 */
export class DuplicateEmailException extends AppException {
  /**
   * Creates a new DuplicateEmailException
   * @param email The email address that already exists
   * @param correlationId Unique identifier to correlate logs (optional)
   */
  constructor(
    email: string,
    correlationId?: string
  ) {
    super(
      `A client with the email "${email}" already exists.`,
      HttpStatus.CONFLICT,
      { email },
      correlationId
    );
  }
}

/**
 * Exception for general business logic errors
 * Maps to HTTP 400 Bad Request
 */
export class BusinessException extends AppException {
  /**
   * Creates a new BusinessException
   * @param message Human-readable error message
   * @param code Business-specific error code (optional)
   * @param details Additional error context (optional)
   * @param correlationId Unique identifier to correlate logs (optional)
   */
  constructor(
    message: string,
    code?: string,
    details?: Record<string, unknown>,
    correlationId?: string
  ) {
    super(
      message,
      HttpStatus.BAD_REQUEST,
      { code, ...details },
      correlationId
    );
  }
}