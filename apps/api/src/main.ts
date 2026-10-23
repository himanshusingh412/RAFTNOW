import './common/serialization/bigint-json';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/exceptions/global-exception.filter';
import { assertEnvironment } from './common/config/env.validation';
import { RootController } from './root.controller';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  assertEnvironment(logger); // production refuses to start with missing/placeholder secrets

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
    rawBody: true, // Razorpay webhook signatures are computed over the raw body
  });

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.use(helmet());
  app.getHttpAdapter().getInstance().set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
  app.enableShutdownHooks();

  app.setGlobalPrefix('api/v1', { exclude: ['/'] });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Idempotency-Key'],
  });

  if (process.env.APP_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('RaftNow API')
      .setDescription('RaftNow — Rishikesh rafting marketplace API')
      .setVersion(process.env.APP_VERSION ?? '0.0.1')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  }

  const port = parseInt(process.env.PORT ?? '4000', 10);
  await app.listen(port, '0.0.0.0');
  logger.log(`RaftNow API listening on :${port} (env=${process.env.APP_ENV ?? 'development'})`);
  if (process.env.APP_ENV !== 'production') logger.log(`Swagger: http://localhost:${port}/api/docs`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
