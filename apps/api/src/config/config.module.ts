import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';
import { AppConfigService } from './app-config.service';
import { validateEnv } from './env.schema';

/**
 * Env lives in a single `.env` at the repo root — one file for the API, the
 * Prisma CLI and docker compose, so they can never drift apart. `validate`
 * replaces the raw process env with the parsed/coerced object, which is what
 * AppConfigService reads.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')],
      validate: validateEnv,
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
