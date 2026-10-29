import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DynamooseModule } from 'nestjs-dynamoose';
import { AppException } from '../../../errors/exception-types';
import { UserSchema } from '../schemas/user.schema';
import { UsersService } from './services/users.service';

/**
 * Lazy module for user operations.
 * This module is lazy-loaded when user services are accessed via LazyModuleLoader.
 * Used for dynamic lazy loading - does not include controller.
 */
@Module({
  imports: [
    ConfigModule,
    DynamooseModule.forFeatureAsync([
      {
        name: "User",
        useFactory: (_, configService: ConfigService) => {
          return {
            schema: UserSchema,
            options: {
              tableName: `${configService.get<string>("APP_NAME")}_${configService.get<string>("NODE_ENV")}_users`,
              create: true,
            },
          };
        },
        inject: [ConfigService],
      },
    ]),
    AppException,
  ],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersLazyModule {}
