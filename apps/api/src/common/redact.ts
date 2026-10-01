/**
 * What a request body may carry into a log line or a Sentry event.
 * `instrument.ts` sets `sendDefaultPii: false` so a mobile number or a PIN never leaves inside a
 * stack frame; a body attached by hand would undo that, so every one goes through here first.
 * Bounded as well as scrubbed — an unbounded body fills the disk it was meant to help debug.
 */
const REDACTED = '[redacted]';
const TOO_DEEP = '[deep]';
const MAX_CHARS = 2_000;
const MAX_DEPTH = 6;
const MAX_ITEMS = 20;

const SECRET_WORDS = new Set([
  'pin',
  'password',
  'otp',
  'token',
  'secret',
  'mobile',
  'phone',
  'email',
  'aadhaar',
  'pan',
  'dob',
]);

/** Whole key first, so an acronym like `PIN` matches; then per word, so `newPin` and `mobileNumber` do too. */
function isSecret(key: string): boolean {
  if (SECRET_WORDS.has(key.toLowerCase())) return true;

  return key.split(/(?=[A-Z])|[_\s-]/).some((word) => SECRET_WORDS.has(word.toLowerCase()));
}

export function redact(value: unknown): unknown {
  const stripped = strip(value, 0);
  const json = JSON.stringify(stripped);

  // Truncated once, at the top: a per-level check would restringify every branch it walked.
  if (json === undefined || json.length <= MAX_CHARS) return stripped;
  return { truncated: json.slice(0, MAX_CHARS) };
}

function strip(value: unknown, depth: number): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return TOO_DEEP;
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((item) => strip(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, held] of Object.entries(value)) {
    out[key] = isSecret(key) ? REDACTED : strip(held, depth + 1);
  }

  return out;
}

/** Enough of a mobile to find the student in the database, never enough to be the number. */
export function maskedMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, '');
  return digits.length <= 4 ? '****' : `****${digits.slice(-4)}`;
}

/** A push endpoint's host says which service refused us; its path is the device's send credential. */
export function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'an unparseable endpoint';
  }
}
