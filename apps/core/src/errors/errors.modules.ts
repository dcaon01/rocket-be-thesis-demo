import { Module, Global, DynamicModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { GlobalExceptionFilter } from './global-exception.filter';

/**
 * Configuration options for ErrorsModule
 */
export interface ErrorsModuleOptions {
  /**
   * If true, will log errors with detailed information
   * Typically enabled in development, disabled in production
   */
  detailedLogs?: boolean;
  
  /**
   * Custom callback for critical error notifications
   * Useful for integrations with external monitoring services
   * (e.g. Sentry, New Relic, Datadog, etc.)
   * 
   * @param error The original error object
   * @param correlationId A unique correlation ID for tracking
   */
  errorNotifier?: (error: Error, correlationId: string) => void;
}

/**
 * ErrorsModule - A global module for centralized error management.
 * 
 * This module provides a consistent way to handle exceptions across the application:
 * - Standardized error response format
 * - Custom exception types for different scenarios
 * - Global exception filter that captures all unhandled exceptions
 * - Integration points with external monitoring tools
 * 
 * Usage:
 * ```typescript
 * // In app.module.ts
 * @Module({
 *   imports: [
 *     ErrorsModule.forRoot({
 *       detailedLogs: process.env.NODE_ENV === 'development',
 *       errorNotifier: (error, correlationId) => {
 *         // Integration with your monitoring system
 *       }
 *     }),
 *     // Other modules...
 *   ]
 * })
 * export class AppModule {}
 * ```
 */
@Global()
@Module({})
export class ErrorsModule {
  /**
   * Configures the errors module with custom options
   * 
   * @param options Configuration options for error handling behavior
   * @returns A dynamic module with configured providers
   */
  static forRoot(options: ErrorsModuleOptions = {}): DynamicModule {
    return {
      module: ErrorsModule,
      providers: [
        {
          provide: 'ERROR_MODULE_OPTIONS',
          useValue: options,
        },
        {
          provide: APP_FILTER,
          useClass: GlobalExceptionFilter,
        }
      ],
      exports: [],
    };
  }
}

// Re-export all exception types to facilitate importing
export * from './exception-types';