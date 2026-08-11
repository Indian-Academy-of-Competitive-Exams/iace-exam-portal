import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';
import { REQUEST_ID_HEADER } from './common/request-id';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(AppConfigService);

  app.use(helmet());

  const origins = config.get('CORS_ORIGINS');
  app.enableCors({
    origin: origins.length > 0 ? origins : true,
    credentials: true,
    // Without this the browser hides the header, and the SPA could not report
    // the request id for a response it never got to parse.
    exposedHeaders: [REQUEST_ID_HEADER],
  });

  // Ensures Prisma disconnects and Redis quits cleanly on SIGTERM — containers
  // get rescheduled routinely and must not drop connections mid-flight.
  app.enableShutdownHooks();

  const port = config.get('API_PORT');
  await app.listen(port, '0.0.0.0');

  Logger.log(`API listening on http://localhost:${port} (${config.get('NODE_ENV')})`, 'Bootstrap');
  Logger.log(`Health check: http://localhost:${port}/health`, 'Bootstrap');
}

void bootstrap();
