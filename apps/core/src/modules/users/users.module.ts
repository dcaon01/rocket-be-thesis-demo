import { Module } from '@nestjs/common';
import { UsersController } from './controllers/users.controller';

/**
 * Lightweight module for Users.
 * Only registers the controller - the actual UsersService is lazy-loaded
 * via UsersLazyModule when a request arrives.
 */
@Module({
  controllers: [UsersController],
})
export class UsersModule {}
