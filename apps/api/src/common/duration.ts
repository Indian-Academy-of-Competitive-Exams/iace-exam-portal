const UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/**
 * Turns a JWT-style duration ("15m", "30d", "900") into seconds. We need the
 * numeric value alongside the string: jsonwebtoken takes the string, while
 * clients and Redis TTLs need the number.
 */
export function durationToSeconds(value: string): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(value.trim());
  if (!match) throw new Error(`Invalid duration: "${value}" (expected e.g. 15m, 24h, 30d)`);

  const amount = Number(match[1]);
  const unit = match[2] ?? 's';
  return amount * (UNITS[unit] ?? 1);
}
