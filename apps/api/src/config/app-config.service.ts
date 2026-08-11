import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NODE_ENVS, type Env } from './env.schema';

/**
 * Typed accessor over the zod-validated env. Inject this, not ConfigService —
 * every key is checked against `Env`, so a typo is a compile error.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get isProduction(): boolean {
    return this.get('NODE_ENV') === NODE_ENVS.PRODUCTION;
  }

  get isDevelopment(): boolean {
    return this.get('NODE_ENV') === NODE_ENVS.DEVELOPMENT;
  }
}
