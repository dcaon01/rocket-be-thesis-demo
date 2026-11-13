import { Module } from '@nestjs/common';
import { TrialsController } from './controllers/trials.controller';

/**
 * Module for trials.
 * Trials are objects modelling a pre-contractual agreement between a client.
 * A trial is just a contract with a limited duration.
 */
@Module({
  controllers: [TrialsController],
})
export class TrialsModule {}
