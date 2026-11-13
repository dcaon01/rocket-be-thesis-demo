import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger, INestApplication } from '@nestjs/common';

const isDev = process.env.NODE_ENV === 'development';
const logger = new Logger('Bootstrap');

async function configureSwagger(app: INestApplication<any>) {
  const { SwaggerModule, DocumentBuilder } = await import('@nestjs/swagger');
  const swaggerConfig = new DocumentBuilder()
    .setTitle(process.env.SWAGGER_TITLE ?? 'Missing title')
    .setDescription(
      `<br><br><a href='/swagger-json' download='swagger-${process.env.APP_NAME}'>Download JSON file</a><br><br><a href='/swagger-yaml' download='swagger-${process.env.APP_NAME}'>Download YAML file</a>`,
    )
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('swagger', app, document);
  logger.log('Swagger configured successfully.'); // CI trigger
}

async function bootstrap() {
  try {
    const app = await NestFactory.create(AppModule, {
      logger: isDev ? ['log', 'debug', 'error', 'warn'] : ['log', 'error', 'warn'],
    });

    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
      }),
    );

    app.setGlobalPrefix(process.env.APP_NAME ?? 'missing-app-name');

    if (isDev) {
      await configureSwagger(app);
    }

    const port = process.env.PORT || 3154;
    await app.listen(port, '0.0.0.0');

    if (isDev) {
      const appUrl = await app.getUrl();
      logger.log(`Application is running on: ${appUrl}`);
      logger.log(`Swagger live on: ${appUrl}/swagger`);
    }
  } catch (error) {
    logger.error('Error during application bootstrap', error);
    process.exit(1);
  }
}

void bootstrap();
