/**
 * Every env file names the same keys. The API's schema is the list; a developer's machine adds
 * LOCAL_ONLY to it, and a deployed box drops those and adds DEPLOY_ONLY. Each template must name
 * exactly its profile's keys, and a real file beside it, where one exists, exactly its template's.
 * Names only are read and printed, never a value.   pnpm env:check
 */
import { existsSync, readFileSync } from 'node:fs';

const SCHEMA = 'apps/api/src/config/env.schema.ts';

/** Set on a developer's machine alone: Docker's ports, the tooling, and what compose.yml sets per container. */
const LOCAL_ONLY = [
  'API_PORT',
  'API_ROLE',
  'UV_THREADPOOL_SIZE',
  'NODE_OPTIONS',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
  'POSTGRES_PORT',
  'SHADOW_DATABASE_URL',
  'TEST_DATABASE_URL',
  'REDIS_PORT',
  'MINIO_PORT',
  'MINIO_CONSOLE_PORT',
  'SONAR_HOST_URL',
  'SONAR_TOKEN',
  'VITE_API_URL',
];

/** Read by compose, Caddy and alloy on a box, or kept there as the operator's reference. */
const DEPLOY_ONLY = [
  'API_HOST',
  'ACME_EMAIL',
  'EXAM_CPU_SHARES',
  'EXAM_MEM',
  'EXAM_HEAP_MB',
  'CORE_CPU_SHARES',
  'CORE_MEM',
  'CORE_HEAP_MB',
  'WORKER_CPU_SHARES',
  'WORKER_MEM',
  'WORKER_HEAP_MB',
  'AWS_REGION',
  'BOX_A',
  'BOX_B',
  'DB_HOST',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  'VALKEY_HOST',
  'VALKEY_PORT',
  'VALKEY_PASSWORD',
  'ENVIRONMENT',
  'LOKI_URL',
  'LOKI_USERNAME',
  'LOKI_PASSWORD',
  'PROM_URL',
  'PROM_USERNAME',
  'PROM_PASSWORD',
];

/** The keys of the one `z.object({ … })` the API validates its environment against. */
function schemaKeys() {
  const source = readFileSync(SCHEMA, 'utf8');
  const body = /export const envSchema = z\.object\(\{\n([\s\S]*?)\n\}\);/.exec(source)?.[1];
  if (!body) throw new Error(`${SCHEMA}: envSchema was not found`);
  return [...body.matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)].map((match) => match[1]);
}

/** Every `KEY=` line, in order, duplicates included. */
const keysOf = (path) =>
  [...readFileSync(path, 'utf8').matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]);

/** What differs between two lists of names, said so the fix is obvious. */
function drift(path, found, wanted, against) {
  const have = new Set(found);
  const want = new Set(wanted);
  return [
    ...wanted
      .filter((key) => !have.has(key))
      .map((key) => `${path}: ${key} is missing (${against} has it)`),
    ...found.filter((key) => !want.has(key)).map((key) => `${path}: ${key} is not in ${against}`),
    ...found
      .filter((key, at) => found.indexOf(key) !== at)
      .map((key) => `${path}: ${key} is set twice`),
  ];
}

const api = schemaKeys();
const PROFILES = [
  {
    template: '.env.example',
    keys: [...new Set([...api, ...LOCAL_ONLY])],
    files: ['.env', 'deploy/.env.local'],
  },
  {
    template: 'deploy/.env.example',
    keys: [...api.filter((key) => !LOCAL_ONLY.includes(key)), ...DEPLOY_ONLY],
    files: ['deploy/.env', 'deploy/.env.staging', 'deploy/.env.production'],
  },
];

const problems = [];
let compared = 0;
for (const { template, keys, files } of PROFILES) {
  const named = keysOf(template);
  problems.push(...drift(template, named, keys, 'the schema and its profile'));
  for (const file of files.filter((path) => existsSync(path))) {
    problems.push(...drift(file, keysOf(file), named, template));
    compared += 1;
  }
}

if (problems.length > 0) {
  console.error(`${problems.join('\n')}\n\n${problems.length} env key problem(s).`);
  process.exit(1);
}
console.log(`env: ${api.length} API keys, 2 templates and ${compared} real file(s) agree.`);
