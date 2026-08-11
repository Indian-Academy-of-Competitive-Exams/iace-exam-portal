import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';
import { REQUEST_ID_HEADER } from './common/request-id';
import { registerBodyParsers } from './common/body-parsers';

async function bootstrap(): Promise<void> {
  // bodyParser: false so the limits in registerBodyParsers are the only ones
  // that apply — Nest's default parser would otherwise be installed first, and
  // first parser wins.
  const app = await NestFactory.create(AppModule, { bufferLogs: false, bodyParser: false });
  const config = app.get(AppConfigService);

  app.use(helmet());
  registerBodyParsers(app);

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
