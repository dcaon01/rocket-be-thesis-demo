import { Module, DynamicModule, Provider } from '@nestjs/common';
import { ServiceLoggingInterceptor, LoggingInterceptorOptions } from './service-logging.interceptor';
import { APP_INTERCEPTOR } from '@nestjs/core';

/**
 * LoggingModule - A global module for centralized application log
 * 
 * This module provides:
 * - Consistent logging of requests/responses across all routes
 * - Performance tracking for all service calls
 * - Response time monitoring
 * - Correlation ID for request tracing
 * - Redaction of sensitive data
 * 
 * Used in conjunction with ErrorsModule for comprehensive observability
 * 
 * Usage:
 * ```typescript
 * // In app.module.ts
 * @Module({
 *   imports: [
 *     LoggingModule.forRoot({
 *       logRequestBody: process.env.NODE_ENV === 'development',
 *       logResponseBody: process.env.NODE_ENV === 'development',
 *       maxResponseSize: 50000,
 *       logPrefix: 'MyAPI',
 *       sensitiveFields: ['password', 'token', 'apiKey'],
 *     }),
 *     // Other modules...
 *   ]
 * })
 * export class AppModule {}
 * ```
 */
@Module({})
export class LoggingModule {
  /**
   * Registers the logging module with global interceptors
   * 
   * @param options Configuration options for the logging interceptor
   * @returns Dynamic module with configured providers
   */
  static forRoot(options?: LoggingInterceptorOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: 'LOGGING_OPTIONS',
      useValue: options || {},
    };
    const interceptorProvider: Provider = {
      provide: APP_INTERCEPTOR,
      useClass: ServiceLoggingInterceptor,
    };
    return {
      module: LoggingModule,
      providers: [optionsProvider, interceptorProvider],
      global: true,
    };
  }
}