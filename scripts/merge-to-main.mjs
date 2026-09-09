/**
 * Fast-forwards main onto this workspace's branch, holding a lock every workspace
 * shares — two agents merging at once is the race this exists to prevent.
 * Nothing but a fast-forward: fold main in HERE first, so the tree the gates
 * passed is exactly the tree main ends up with.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MAIN = 'main';
const PROTECTED = new Set([MAIN, 'prod', 'test']);
const GATE = ['format:check', 'lint', 'typecheck', 'test', 'build'];
const GATE_STEP_TIMEOUT_MS = 10 * 60_000;
const LOCK_WAIT_MS = 15 * 60_000;
const LOCK_STALE_MS = 30 * 60_000;
const LOCK_POLL_MS = 2_000;

function git(args, cwd = process.cwd()) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function fail(message, ...detail) {
  process.stderr.write(`\n✖ ${message}\n`);
  for (const line of detail) process.stderr.write(`  ${line}\n`);
  process.exit(1);
}

function say(message) {
  process.stdout.write(`\n\x1b[1m==> ${message}\x1b[0m\n`);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Every worktree of this clone shares one git dir, so it is the identity the lock is keyed on. */
function lockPath() {
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const slug = common.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  return join(homedir(), '.superset', `merge-${slug}.lock`);
}

function lockHolder(path) {
  try {
    return JSON.parse(readFileSync(join(path, 'owner.json'), 'utf8'));
  } catch {
    return null;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function acquireLock(path) {
  const deadline = Date.now() + LOCK_WAIT_MS;
  let announced = false;

  for (;;) {
    try {
      mkdirSync(path, { recursive: false });
      const owner = {
        pid: process.pid,
        workspace: process.cwd(),
        startedAt: new Date().toISOString(),
      };
      writeFileSync(join(path, 'owner.json'), `${JSON.stringify(owner, null, 2)}\n`);
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }

    const holder = lockHolder(path);
    const startedAt = holder ? Date.parse(holder.startedAt) : 0;
    const stale = !holder || (!alive(holder.pid) && Date.now() - startedAt > LOCK_STALE_MS);
    if (stale) {
      rmSync(path, { recursive: true, force: true });
      continue;
    }

    if (!announced) {
      say(`waiting — ${holder.workspace} is merging into ${MAIN}`);
      announced = true;
    }
    if (Date.now() > deadline) {
      fail(
        `gave up after ${LOCK_WAIT_MS / 60_000} minutes waiting for the merge lock`,
        `held by ${holder.workspace} (pid ${holder.pid})`,
        `if that is dead: rm -rf ${path}`,
      );
    }
    sleepSync(LOCK_POLL_MS);
  }
}

function counts(branch) {
  const [behind, ahead] = git(['rev-list', '--left-right', '--count', `${MAIN}...${branch}`])
    .split(/\s+/)
    .map(Number);
  return { behind, ahead };
}

/** The worktree that has main checked out, if any — git will not let a second one take it. */
function mainWorktree() {
  const entries = git(['worktree', 'list', '--porcelain']).split('\n\n');
  for (const entry of entries) {
    const path = /^worktree (.+)$/m.exec(entry)?.[1];
    const branch = /^branch refs\/heads\/(.+)$/m.exec(entry)?.[1];
    if (path && branch === MAIN) return path;
  }
  return null;
}

/** Superset lays its worktrees out as ~/.superset/worktrees/<workspace-id>/<name>. */
function supersetWorkspaceId(path) {
  const root = join(homedir(), '.superset', 'worktrees');
  if (!path.startsWith(`${root}/`)) return null;
  return path.slice(root.length + 1).split('/')[0] || null;
}

function supersetDelete(id) {
  const cli = join(homedir(), '.superset', 'bin', 'superset');
  try {
    execFileSync(cli, ['workspaces', 'delete', id, '--local'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Releasing the ports and stopping the servers is teardown's job either way. */
function runTeardown(path) {
  try {
    execFileSync('bash', ['./.superset/teardown.sh'], { cwd: path, stdio: 'ignore' });
  } catch {
    /* a workspace without the script, or one already torn down */
  }
}

function removeWorkspace(branch, host) {
  const path = process.env.SUPERSET_WORKSPACE_PATH ?? process.cwd();
  runTeardown(path);
  process.chdir(host);

  const id = supersetWorkspaceId(path);
  if (id && supersetDelete(id)) return `Superset deleted workspace ${id}`;

  git(['worktree', 'remove', '--force', path], host);
  git(['branch', '-d', branch], host);
  const hint = id ? ' (superset CLI unavailable — removed with git)' : '';
  return `worktree removed and ${branch} deleted${hint}`;
}

function runGate() {
  for (const step of GATE) {
    say(`gate: pnpm ${step}`);
    try {
      execFileSync('pnpm', [step], {
        cwd: process.cwd(),
        stdio: 'inherit',
        timeout: GATE_STEP_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      });
    } catch (error) {
      const timedOut = error.signal === 'SIGKILL';
      fail(
        timedOut
          ? `pnpm ${step} did not finish in ${GATE_STEP_TIMEOUT_MS / 60_000} minutes`
          : `pnpm ${step} failed`,
        `${MAIN} is untouched — fix it, commit, and run pnpm ws:merge again`,
      );
    }
  }
}

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
if (PROTECTED.has(branch)) fail(`HEAD is on ${branch} — there is nothing to merge from here`);
if (git(['status', '--porcelain']))
  fail(
    'this workspace has uncommitted changes',
    'commit them first — a merge must carry a tree the gates saw',
  );

const before = counts(branch);
if (before.ahead === 0) fail(`${branch} has no commits ${MAIN} lacks`);
if (before.behind > 0) {
  fail(
    `${MAIN} is ${before.behind} commit(s) ahead of ${branch}, so this cannot fast-forward`,
    `fold it in here first:  git merge ${MAIN}`,
    'then run the gates again and retry — the tree that ships must be the tree that passed',
  );
}

runGate();

const lock = lockPath();
let host = null;
acquireLock(lock);
try {
  const after = counts(branch);
  if (after.behind > 0) {
    fail(
      `${MAIN} moved while this waited for the lock`,
      `fold it in and retry:  git merge ${MAIN}`,
    );
  }

  say(`fast-forwarding ${MAIN} to ${branch}`);
  host = mainWorktree();
  if (host) {
    if (git(['status', '--porcelain'], host))
      fail(`${host} has uncommitted changes on ${MAIN}`, 'clean it, then retry');
    git(['merge', '--ff-only', branch], host);
    process.stdout.write(`    ${host} is now at ${git(['rev-parse', '--short', MAIN], host)}\n`);
  } else {
    git(['update-ref', `refs/heads/${MAIN}`, git(['rev-parse', 'HEAD'])]);
    process.stdout.write(`    ${MAIN} is now at ${git(['rev-parse', '--short', MAIN])}\n`);
  }
} finally {
  rmSync(lock, { recursive: true, force: true });
}

say('merged');

if (!host) {
  process.stdout.write(`    ${MAIN} is not checked out anywhere — nothing to remove\n`);
} else if (process.argv.includes('--keep')) {
  process.stdout.write('    --keep: this workspace and its branch are left in place\n');
} else {
  process.stdout.write(`    ${removeWorkspace(branch, host)}\n`);
}
