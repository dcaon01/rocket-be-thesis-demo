import { Module } from '@nestjs/common';
import { CognitoController } from './controllers/cognito.controller';

/**
 * Lightweight module for AWS Cognito management ops.
 * Only registers the controller - the actual services are lazy-loaded
 * via CognitoLazyModule when a request arrives, so the app can bootstrap
 * without the Cognito/DynamoDB environment configured.
 */
@Module({
  controllers: [CognitoController],
})
export class CognitoModule {}
