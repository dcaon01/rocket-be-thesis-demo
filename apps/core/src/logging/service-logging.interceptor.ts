import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
    Logger,
    LoggerService,
    Optional,
    Inject,
  } from "@nestjs/common";
  import { Observable } from "rxjs";
  import { catchError, map } from "rxjs/operators";
  import { v4 as uuidv4 } from 'uuid';
  import { Request, Response } from 'express';
  
  /**
   * Configuration options for the logging interceptor
   */
  export interface LoggingInterceptorOptions {
    /**
     * Whether to include request bodies in logs
     * Note: May contain sensitive data
     */
    logRequestBody?: boolean;
  
    /**
     * Whether to include response bodies in logs
     * Note: Can result in large log entries
     */
    logResponseBody?: boolean;
  
    /**
     * Field names to redact from logs for security/privacy
     * Example: ['password', 'token', 'ssn']
     */
    sensitiveFields?: string[];
  
    /**
     * Maximum response size to log (in bytes)
     * Prevents massive log entries for large responses
     */
    maxResponseSize?: number;
  
    /**
     * Custom logger service
     * If not provided, will use NestJS Logger
     */
    logger?: LoggerService;
  
    /**
     * Prefix for log messages
     * Helps identify logs from this interceptor
     */
    logPrefix?: string;
  }
  
  /**
   * ServiceLoggingInterceptor - A comprehensive request/response logging system
   * 
   * This interceptor provides:
   * - Detailed request/response logging
   * - Performance measurement of request duration
   * - Request correlation IDs for tracking requests across logs
   * - Sensitive data redaction
   * 
   * Usage:
   * - Can be applied globally, to controllers, or to specific routes
   * - Configurable to adjust log verbosity based on environment
   * - Integrates with the error handling system via correlationId
   */
  @Injectable()
  export class ServiceLoggingInterceptor implements NestInterceptor {
    private readonly logger: LoggerService;
    private readonly options: LoggingInterceptorOptions;
  
    /**
     * Creates a new instance of ServiceLoggingInterceptor
     * @param options Configuration options for the interceptor
     */
    constructor(@Optional() @Inject('LOGGING_OPTIONS') options?: LoggingInterceptorOptions) {
      this.options = {
        logRequestBody: true,
        logResponseBody: true,
        sensitiveFields: ['password', 'token', 'secret', 'authorization', 'apiKey'],
        maxResponseSize: 10000, // 10KB
        logPrefix: 'Service',
        ...options
      };
  
      this.logger = this.options.logger || new Logger(this.options.logPrefix);
    }
  
    /**
     * Intercepts the request/response cycle to provide logging
     * 
     * @param context The execution context (contains request info)
     * @param next The call handler (represents the route handler)
     * @returns An observable with the handler's response
     */
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
      // Generate a unique ID for this request (for correlation)
      const requestId = uuidv4();
      const className = context.getClass().name;
      const handlerName = context.getHandler().name;
      const methodSignature = `${className}.${handlerName}`;
      const isDev = process.env.NODE_ENV === "development";
      
      // Get HTTP context if available
      const httpContext = context.switchToHttp();
      const request = httpContext.getRequest<Request>();
      const startTime = Date.now();
  
      // Store correlationId in request for error handler to use
      if (request) {
        (request as Request & { correlationId: string })['correlationId'] = requestId;
      }
  
      // Log request details
      if (request) {
        const { method, url, ip } = request;
        const userAgent = request.get('user-agent') || 'unknown';
        
        const logData = {
          requestId,
          timestamp: new Date().toISOString(),
          method,
          url,
          ip,
          userAgent,
          params: request.params || {},
          query: request.query || {},
        };
  
        // Add body if configured and available
        if (this.options.logRequestBody && request.body) {
          logData['body'] = this._sanitizeData(request.body);
        }
  
        this.logger.log(
          `[REQ:${requestId}] ${methodSignature} - ${JSON.stringify(logData)}`,
        );
      } else {
        // For non-HTTP contexts (e.g., WebSockets, gRPC)
        this.logger.log(
          `[REQ:${requestId}] ${methodSignature} called`,
        );
      }
  
      return next.handle().pipe(
        map((data: unknown) => {
          const response = httpContext.getResponse<Response>();
          const duration = Date.now() - startTime;
          const statusCode = response?.statusCode;

          const loggedResponse: { statusCode: number | undefined; duration: string; body?: unknown; responseSize?: number } = {
            statusCode,
            duration: `${duration}ms`
          };

          // Log response body if enabled and not too large
          if (this.options.logResponseBody && data) {
            const stringifiedData = JSON.stringify(data);
            if (stringifiedData.length <= (this.options.maxResponseSize ?? 10000)) {
              loggedResponse.body = this._sanitizeData(data);
            } else {
              loggedResponse.body = '[Response too large to log]';
              loggedResponse.responseSize = stringifiedData.length;
            }
          }

          this.logger.log(
            `[RES:${requestId}] ${methodSignature} completed in ${duration}ms - ${JSON.stringify(loggedResponse)}`
          );

          // Add performance logging in development
          if (isDev && duration > 1000) {
            this.logger.warn(
              `[PERF:${requestId}] Slow operation detected: ${methodSignature} took ${duration}ms`
            );
          }

          return data;
        }),
        catchError(error => {
          // We don't log errors here - they are handled by the GlobalExceptionFilter
          // Just rethrow the error
          throw error;
        })
      );
    }
  
    /**
     * Removes or masks sensitive data from logged objects
     * 
     * @param data The data to sanitize
     * @returns Sanitized data safe for logging
     */
    private _sanitizeData(data: unknown): unknown {
      if (!data || typeof data !== 'object') {
        return data;
      }

      // Create a deep copy to avoid modifying original data
      const sanitized: Record<string, unknown> = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;

      const sanitizeObject = (obj: Record<string, unknown>) => {
        if (!obj || typeof obj !== 'object') return;

        for (const key in obj) {
          if (this.options.sensitiveFields?.includes(key.toLowerCase())) {
            obj[key] = '[REDACTED]';
          } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            sanitizeObject(obj[key] as Record<string, unknown>);
          }
        }
      };

      sanitizeObject(sanitized);
      return sanitized;
    }
  }