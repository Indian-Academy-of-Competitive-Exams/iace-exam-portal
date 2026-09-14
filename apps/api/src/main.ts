import './instrument';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';
import { REQUEST_ID_HEADER } from './common/request-id';
import { corsOrigin, helmetOptions } from './common/security-headers';

async function bootstrap(): Promise<void> {
  // bodyParser: false, or Nest's default parser is installed first and its limit is the one that wins.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
    bodyParser: false,
  });
  const config = app.get(AppConfigService);

  app.use(helmet(helmetOptions));
  // Uploads are multipart and capped by multer, so every JSON or form body gets the small limit.
  const bodyLimit = config.get('BODY_LIMIT_DEFAULT');
  app.useBodyParser('json', { limit: bodyLimit });
  app.useBodyParser('urlencoded', { extended: true, limit: bodyLimit });

  // What makes `req.ip` the caller rather than the load balancer, which every rate limit counts on.
  app.set('trust proxy', config.get('TRUST_PROXY_HOPS'));

  const origins = config.get('CORS_ORIGINS');
  app.enableCors({
    origin: corsOrigin(origins, config.isProduction),
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
