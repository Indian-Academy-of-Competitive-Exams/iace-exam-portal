/**
 * Per-workspace dev ports (https://docs.superset.sh/ports).
 * Superset discovers ports, it does not hand them out, so every worktree would try
 * 3000/5173/5174 — and both vite configs set strictPort, so the second one just dies.
 * A slot is reserved in ~/.superset/port-allocations.json, keyed by worktree path.
 */
import { createServer } from 'node:net';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const REGISTRY = join(homedir(), '.superset', 'port-allocations.json');
const LOCK = `${REGISTRY}.lock`;
const WORKSPACE = resolve(process.env.SUPERSET_WORKSPACE_PATH ?? process.cwd());
const ENV_FILE = join(WORKSPACE, '.env');
const PORTS_FILE = join(WORKSPACE, '.superset', 'ports.json');

/** Slot 0 is the first workspace; the main checkout keeps 3000/5173/5174 to itself. */
const SERVICES = [
  { key: 'API_PORT', base: 3100, label: 'API' },
  { key: 'TEST_PORT', base: 5200, label: 'Test portal' },
  { key: 'ADMIN_PORT', base: 5300, label: 'Admin portal' },
];
const MAX_SLOTS = 80;
const LOCK_TIMEOUT_MS = 10_000;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

async function withLock(fn) {
  mkdirSync(dirname(LOCK), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      mkdirSync(LOCK);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() > deadline) rmSync(LOCK, { recursive: true, force: true });
      else sleepSync(50);
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(LOCK, { recursive: true, force: true });
  }
}

function readRegistry() {
  if (!existsSync(REGISTRY)) return {};
  try {
    const parsed = JSON.parse(readFileSync(REGISTRY, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeRegistry(registry) {
  mkdirSync(dirname(REGISTRY), { recursive: true });
  writeFileSync(REGISTRY, `${JSON.stringify(registry, null, 2)}\n`);
}

/** A deleted worktree cannot give its ports back, so every read drops the ones that vanished. */
function prune(registry) {
  return Object.fromEntries(Object.entries(registry).filter(([path]) => existsSync(path)));
}

function portsOf(entry) {
  return entry && typeof entry.ports === 'object' ? Object.values(entry.ports) : [];
}

function isFree(port) {
  return new Promise((done) => {
    const server = createServer();
    server.once('error', () => done(false));
    server.once('listening', () => server.close(() => done(true)));
    server.listen(port, '0.0.0.0');
  });
}

async function slotIsUsable(slot, taken) {
  for (const service of SERVICES) {
    const port = service.base + slot;
    if (taken.has(port)) return false;
    if (!(await isFree(port))) return false;
  }
  return true;
}

async function allocate() {
  return withLock(async () => {
    const raw = readRegistry();
    const registry = prune(raw);
    if (Object.keys(registry).length !== Object.keys(raw).length) writeRegistry(registry);
    const taken = new Set(
      Object.entries(registry)
        .filter(([path]) => path !== WORKSPACE)
        .flatMap(([, entry]) => portsOf(entry)),
    );

    const mine = registry[WORKSPACE];
    if (mine && !portsOf(mine).some((port) => taken.has(port))) return mine.ports;

    for (let slot = 0; slot < MAX_SLOTS; slot += 1) {
      if (!(await slotIsUsable(slot, taken))) continue;
      const ports = Object.fromEntries(SERVICES.map((s) => [s.key, s.base + slot]));
      registry[WORKSPACE] = { slot, ports, updatedAt: new Date().toISOString() };
      writeRegistry(registry);
      return ports;
    }
    throw new Error(`no free port slot in the first ${MAX_SLOTS} — close some workspaces`);
  });
}

async function release() {
  return withLock(async () => {
    const registry = readRegistry();
    const mine = registry[WORKSPACE];
    delete registry[WORKSPACE];
    writeRegistry(prune(registry));
    return mine?.ports ?? {};
  });
}

/** Rewrites in place so a re-run is idempotent, and appends the keys .env.example lacks. */
function patchEnvFile(ports) {
  if (!existsSync(ENV_FILE)) return false;
  const values = {
    ...ports,
    VITE_API_URL: `http://localhost:${ports.API_PORT}`,
    CORS_ORIGINS: `http://localhost:${ports.TEST_PORT},http://localhost:${ports.ADMIN_PORT}`,
  };

  let text = readFileSync(ENV_FILE, 'utf8');
  const missing = [];
  for (const [key, value] of Object.entries(values)) {
    const line = new RegExp(`^${key}=.*$`, 'm');
    if (line.test(text)) text = text.replace(line, `${key}=${value}`);
    else missing.push(`${key}=${value}`);
  }
  if (missing.length > 0) {
    text = `${text.replace(/\n*$/, '\n')}\n# ---- Superset workspace ports ----\n${missing.join('\n')}\n`;
  }
  writeFileSync(ENV_FILE, text);
  return true;
}

function writePortLabels(ports) {
  const workspace = process.env.SUPERSET_WORKSPACE_NAME ?? basename(WORKSPACE);
  const labels = SERVICES.map((service) => ({
    port: ports[service.key],
    label: `${service.label} — ${workspace}`,
  }));
  mkdirSync(dirname(PORTS_FILE), { recursive: true });
  writeFileSync(PORTS_FILE, `${JSON.stringify({ ports: labels }, null, 2)}\n`);
}

const command = process.argv[2];

if (command === 'allocate') {
  const ports = await allocate();
  patchEnvFile(ports);
  writePortLabels(ports);
  for (const [key, value] of Object.entries(ports)) process.stdout.write(`${key}=${value}\n`);
} else if (command === 'release') {
  const ports = await release();
  for (const value of Object.values(ports)) process.stdout.write(`${value}\n`);
} else {
  process.stderr.write('usage: ports.mjs allocate|release\n');
  process.exit(1);
}
