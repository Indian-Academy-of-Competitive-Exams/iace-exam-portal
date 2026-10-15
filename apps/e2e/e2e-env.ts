import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

export const ROOT = join(__dirname, '../..');

export const E2E_PAPER = {
  SERIES_NAME: 'E2E Free Mocks',
  TEST_TITLE: 'E2E Smoke Paper',
  STEMS: ['Which planet is known as the Red Planet?', 'Which gas do plants absorb?'],
} as const;

const API_PORT = 3100;
const EXAMS_PORT = 5183;
export const API_URL = `http://localhost:${API_PORT}`;
export const EXAMS_URL = `http://localhost:${EXAMS_PORT}`;
export const EXAMS_DIST = join(__dirname, 'dist/exams');

function devDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const fromFile = parseEnv(readFileSync(join(ROOT, '.env'), 'utf8')).DATABASE_URL;
  if (!fromFile) throw new Error('Set E2E_DATABASE_URL, or DATABASE_URL in .env to derive it');
  return fromFile;
}

/** Its own database, never the dev one or a _test one another run is filling. */
function e2eDatabaseUrl(): string {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  const url = new URL(devDatabaseUrl());
  url.pathname = '/iace_e2e';
  return url.toString();
}

/** Set in full because the API also loads the root .env, and only a variable already set wins. */
export const API_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  API_PORT: String(API_PORT),
  API_ROLE: 'all',
  CORS_ORIGINS: EXAMS_URL,
  DATABASE_URL: e2eDatabaseUrl(),
  REDIS_URL: process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/1',
  JWT_ACCESS_SECRET: 'e2e_only_access_secret_not_for_any_deploy',
  JWT_REFRESH_SECRET: 'e2e_only_refresh_secret_not_for_any_deploy',
  OTP_SENDER: 'console',
  OTP_WHATSAPP_ENABLED: 'false',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'iace-local',
  S3_ACCESS_KEY_ID: 'iace_minio_user',
  S3_SECRET_ACCESS_KEY: 'iace_minio_password',
  S3_FORCE_PATH_STYLE: 'true',
  MEDIA_BASE_URL: 'http://localhost:9000/iace-local',
  LOG_LEVEL: '>=warn',
};
