import {
    ExceptionFilter,
    Catch,
    ArgumentsHost,
    HttpException,
    HttpStatus,
    Logger,
  } from '@nestjs/common';
  import { Request, Response } from 'express';
  import { 
    AppException, 
    ErrorResponse 
  } from './exception-types';
  import { ValidationError } from 'class-validator';
  
  /**
   * Global exception filter that catches all unhandled exceptions in the application
   * and transforms them into consistent HTTP responses.
   * 
   * This filter provides:
   * - Unified error response format for all exceptions
   * - Correlation of errors with request IDs
   * - Environment-aware error details (detailed in development, sanitized in production)
   * - Special handling for validation errors
   * - Comprehensive error logging
   */
  @Catch()
  export class GlobalExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(GlobalExceptionFilter.name);
  
    /**
     * Catches and processes any exception thrown within the application
     * @param exception The exception object caught by the filter
     * @param host The execution context of the current request
     */
    catch(exception: unknown, host: ArgumentsHost) {
      const ctx = host.switchToHttp();
      const response = ctx.getResponse<Response>();
      const request = ctx.getRequest<Request>();
      
      // Extract correlationId from request (added by the logging interceptor)
      const correlationId = (request as Request & { correlationId?: string })['correlationId'] || 'unknown';
      
      // Build the error response
      let errorResponse: ErrorResponse;
      let statusCode: number;
      const isDevelopment = process.env.NODE_ENV === 'development';
  
      if (exception instanceof AppException) {
        // Handle our custom exceptions
        errorResponse = exception.getResponse();
        statusCode = exception.getStatus();
        
        // Add path if not already present
        errorResponse.path = errorResponse.path || request.url;
        errorResponse.correlationId = errorResponse.correlationId || correlationId;
      } 
      else if (exception instanceof HttpException) {
        // Handle standard NestJS exceptions
        statusCode = exception.getStatus();
        const exceptionResponse = exception.getResponse();

        if (typeof exceptionResponse === 'object') {
          // Handle structured error responses (like ValidationPipe errors)
          const responseBody = exceptionResponse as { message?: unknown; error?: string };

          // Special handling for validation errors
          if (Array.isArray(responseBody.message) &&
              responseBody.message[0] instanceof ValidationError) {
            const validationErrors = this._formatValidationErrors(responseBody.message as ValidationError[]);

            errorResponse = {
              statusCode,
              message: 'Validation error',
              error: HttpStatus[statusCode],
              timestamp: new Date().toISOString(),
              path: request.url,
              correlationId,
              details: { validationErrors }
            };
          } else {
            const messageStr = typeof responseBody.message === 'string' ? responseBody.message : 'An error occurred';
            errorResponse = {
              statusCode,
              message: messageStr,
              error: responseBody.error || HttpStatus[statusCode],
              timestamp: new Date().toISOString(),
              path: request.url,
              correlationId,
              details: responseBody.message ? undefined : responseBody
            };
          }
        } else {
          // Handle simple error responses (strings)
          errorResponse = {
            statusCode,
            message: String(exceptionResponse),
            error: HttpStatus[statusCode],
            timestamp: new Date().toISOString(),
            path: request.url,
            correlationId
          };
        }
      } 
      else {
        // Handle non-HTTP exceptions (generic JS errors, unexpected errors)
        statusCode = HttpStatus.INTERNAL_SERVER_ERROR;

        // In production, don't expose error details
        const errorMessage = isDevelopment
          ? (exception instanceof Error ? exception.message : 'Unknown error')
          : 'An internal server error occurred';

        errorResponse = {
          statusCode,
          message: errorMessage,
          error: HttpStatus[statusCode],
          timestamp: new Date().toISOString(),
          path: request.url,
          correlationId
        };

        // In development, add stack trace as detail
        if (isDevelopment && exception instanceof Error) {
          errorResponse.details = { stack: exception.stack };
        }
      }
      
      // Log the error with appropriate level of detail
      this._logError(exception, errorResponse, correlationId);
      
      // Send the formatted response
      response
        .status(statusCode)
        .json(errorResponse);
    }
  
    /**
     * Formats validation errors into a more readable structure
     * @param errors Validation errors from class-validator
     * @returns Formatted validation errors
     */
    private _formatValidationErrors(errors: ValidationError[]): Array<{ property: string; constraints: Record<string, string> | undefined; value: unknown }> {
      return errors.map(error => {
        return {
          property: error.property,
          constraints: error.constraints,
          value: error.value as unknown
        };
      });
    }
    
    /**
     * Logs the error with appropriate detail level based on environment
     * @param exception The original exception
     * @param errorResponse The formatted error response
     * @param correlationId The request correlation ID
     */
    private _logError(exception: unknown, errorResponse: ErrorResponse, correlationId: string): void {
      const isDevelopment = process.env.NODE_ENV === 'development';

      // Basic error information that's always logged
      const errorLogMessage = `[ERR:${correlationId}] ${errorResponse.message} (${errorResponse.statusCode})`;

      // Include sanitized details for context when available
      const detailsString = errorResponse.details
        ? ` - Details: ${JSON.stringify(this._sanitizeErrorDetails(errorResponse.details))}`
        : '';

      // In development, include the stack trace
      if (isDevelopment) {
        const stackTrace = exception instanceof Error ? exception.stack : undefined;
        this.logger.error(
          `${errorLogMessage}${detailsString}`,
          stackTrace
        );
      } else {
        // In production, log without stack trace for cleaner logs
        this.logger.error(`${errorLogMessage}${detailsString}`);
      }
    }
    
    /**
     * Sanitizes error details to prevent sensitive information from being logged
     * @param details The error details to sanitize
     * @returns Sanitized error details
     */
    private _sanitizeErrorDetails(details: Record<string, unknown>): Record<string, unknown> {
      if (!details) return {};

      // Create a copy to avoid modifying the original
      const sanitized: Record<string, unknown> = { ...details };

      // Remove potentially sensitive information
      const sensitiveFields = ['password', 'token', 'secret', 'apiKey', 'credentials'];

      sensitiveFields.forEach(field => {
        if (field in sanitized) {
          sanitized[field] = '[REDACTED]';
        }
      });

      return sanitized;
    }
  }