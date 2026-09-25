import './instrument';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import helmet from 'helmet';
import { REQUEST_ID_HEADER } from '@iace/contracts';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';
import { PREFLIGHT_CACHE_SEC, corsOrigin, helmetOptions } from './common/security-headers';
import { threadpoolRisk } from './common/threadpool';
import { containerMemoryLimit, heapLimitNow, heapRisk } from './common/heap';

/** Longer than any load balancer's idle timeout, or it hangs up on a connection still being reused. */
const KEEP_ALIVE_MS = 65_000;

async function bootstrap(): Promise<void> {
  // bodyParser: false, or Nest's default parser is installed first and its limit is the one that wins.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
    bodyParser: false,
  });
  const config = app.get(AppConfigService);

  // Read, never set: by the time this runs libuv has already sized the pool from the environment.
  const threadpool = threadpoolRisk(process.env.UV_THREADPOOL_SIZE);
  if (threadpool && config.isProduction) Logger.warn(threadpool, 'Bootstrap');

  const heap = heapRisk(heapLimitNow(), containerMemoryLimit());
  if (heap && config.isProduction) Logger.warn(heap, 'Bootstrap');

  app.use(helmet(helmetOptions));
  // A paper is a few hundred kilobytes of JSON; the autosave ack is under the default threshold.
  app.use(compression());
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
    // Without this the browser hides the header, and the SPA could not report the request id for a response it never got to parse.
    exposedHeaders: [REQUEST_ID_HEADER],
    // Every call carries a bearer token, so without this the browser preflights each one again.
    maxAge: PREFLIGHT_CACHE_SEC,
  });

  // Ensures Prisma disconnects and Redis quits cleanly on SIGTERM — containers get rescheduled routinely and must not drop connections mid-flight.
  app.enableShutdownHooks();

  const server = app.getHttpServer();
  server.keepAliveTimeout = KEEP_ALIVE_MS;
  // Must outlast the keep-alive, or a connection can be closed while its next request is arriving.
  server.headersTimeout = KEEP_ALIVE_MS + 1_000;

  const port = config.get('API_PORT');
  await app.listen(port, '0.0.0.0');

  Logger.log(`API listening on http://localhost:${port} (${config.get('NODE_ENV')})`, 'Bootstrap');
  Logger.log(`Health check: http://localhost:${port}/health`, 'Bootstrap');
}

void bootstrap();
