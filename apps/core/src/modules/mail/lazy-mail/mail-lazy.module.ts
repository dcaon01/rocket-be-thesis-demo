import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailService } from './services/mail.service';

/**
 * Lazy module for the emails Rocket sends through SES.
 * It has no controller: other services lazy-load it when they need to send.
 */
@Module({
  imports: [
    ConfigModule,
  ],
  providers: [
    MailService,
  ],
  exports: [
    MailService,
  ],
})
export class MailLazyModule {}
