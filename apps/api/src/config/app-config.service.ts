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

  /**
   * `BODY_LIMIT_IMPORT` as a number of bytes.
   *
   * body-parser takes the "10mb" form, multipart uploads need a count, and the
   * two must be the same limit — a second env var would eventually disagree
   * with the first, and an upload would pass one check and fail the other.
   */
  get importLimitBytes(): number {
    return bytesOf(this.get('BODY_LIMIT_IMPORT'));
  }
}

const BYTE_UNITS: Record<string, number> = { b: 1, kb: 1024, mb: 1024 * 1024 };

/** The env schema already guarantees this shape, so a miss means it changed. */
export function bytesOf(size: string): number {
  const match = /^(\d+)(b|kb|mb)$/.exec(size.trim().toLowerCase());
  if (!match) throw new Error(`Not a byte size: ${size}`);
  return Number(match[1]) * (BYTE_UNITS[match[2] ?? 'b'] ?? 1);
}
