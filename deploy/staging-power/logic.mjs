// Every decision the staging power switch makes, with no AWS in it so `node --test` can run it.
import { createHash, timingSafeEqual } from 'node:crypto';

export const ACTIONS = { ON: 'on', OFF: 'off', KEEP_OFF: 'keep-off' };
export const AUTO_OFF_MODES = { NONE: 'none', NIGHTLY: 'nightly', TIMED: 'timed' };
export const CHECKIN_TAG_PREFIX = 'checkin:';

const CHECKIN_LAPSE_MS = 12 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const NAME_MAX = 30;
const STOPPED = 'stopped';
const DB_AVAILABLE = 'available';
// A valid expression for a schedule that is DISABLED and must never matter.
const PARKED_EXPRESSION = 'rate(7 days)';
const INSTITUTE_TIME_ZONE = 'Asia/Kolkata';

// The state each resource must be in for an action to touch it; anything else is mid-transition.
const ACTS_ON = {
  [ACTIONS.ON]: { api: STOPPED, valkey: STOPPED, db: STOPPED },
  [ACTIONS.OFF]: { api: 'running', valkey: 'running', db: DB_AVAILABLE },
};

export function resourcesToChange(action, states, manageShared) {
  if (action === ACTIONS.KEEP_OFF) {
    return manageShared && states.api === STOPPED && states.db === DB_AVAILABLE ? ['db'] : [];
  }
  const from = ACTS_ON[action];
  if (!from) return [];
  return Object.keys(from).filter(
    (name) => states[name] === from[name] && (name === 'api' || manageShared),
  );
}

// An EC2 tag key takes letters, digits and spaces but no combining marks; anything else fails the write.
export function cleanName(raw) {
  const name = String(raw ?? '')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/ +/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
  return name || null;
}

export function checkedIn(tags, now) {
  return (tags ?? [])
    .filter((tag) => tag.Key.startsWith(CHECKIN_TAG_PREFIX))
    .map((tag) => ({ name: tag.Key.slice(CHECKIN_TAG_PREFIX.length), since: tag.Value }))
    .filter((entry) => now - Date.parse(entry.since) < CHECKIN_LAPSE_MS)
    .sort((a, b) => a.since.localeCompare(b.since));
}

export function othersCheckedIn(list, me) {
  const mine = (me ?? '').toLowerCase();
  return list.filter((entry) => entry.name.toLowerCase() !== mine);
}

export function parseAutoOff(input) {
  const mode = input?.mode;
  if (mode === AUTO_OFF_MODES.NONE) return { mode };
  if (mode === AUTO_OFF_MODES.NIGHTLY && /^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) {
    return { mode, time: input.time };
  }
  if (
    mode === AUTO_OFF_MODES.TIMED &&
    Number.isInteger(input.hours) &&
    input.hours >= 1 &&
    input.hours <= 24
  ) {
    return { mode, hours: input.hours };
  }
  return null;
}

export function scheduleFor(setting, apiRunning, now) {
  if (setting.mode === AUTO_OFF_MODES.NIGHTLY) {
    const [hour, minute] = setting.time.split(':').map(Number);
    return {
      expression: `cron(${minute} ${hour} * * ? *)`,
      timezone: INSTITUTE_TIME_ZONE,
      enabled: true,
    };
  }
  if (setting.mode === AUTO_OFF_MODES.TIMED && apiRunning) {
    const at = new Date(now + setting.hours * HOUR_MS).toISOString().slice(0, 19);
    return { expression: `at(${at})`, timezone: 'UTC', enabled: true };
  }
  return { expression: PARKED_EXPRESSION, timezone: 'UTC', enabled: false };
}

export function sameSecret(given, expected) {
  const digest = (value) =>
    createHash('sha256')
      .update(String(value ?? ''))
      .digest();
  return timingSafeEqual(digest(given), digest(expected));
}

// The API's readiness body names each dependency up or down, on success and refusal alike; only status and timing leave.
export function healthChecks(body) {
  const dependencies = body?.data ?? body?.error?.details;
  if (!dependencies || typeof dependencies !== 'object') return null;
  return Object.fromEntries(
    Object.entries(dependencies)
      .filter(([, check]) => check?.status === 'up' || check?.status === 'down')
      .map(([name, check]) => [name, { status: check.status, latencyMs: check.latencyMs ?? null }]),
  );
}
