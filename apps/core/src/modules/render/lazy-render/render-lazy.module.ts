import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RenderService } from './services/render.service';

/**
 * Lazy module for the rendering of HTML documents into PDF, through the render Lambda.
 * It has no controller: other services lazy-load it when they need a PDF.
 */
@Module({
  imports: [
    ConfigModule,
  ],
  providers: [
    RenderService,
  ],
  exports: [
    RenderService,
  ],
})
export class RenderLazyModule {}
