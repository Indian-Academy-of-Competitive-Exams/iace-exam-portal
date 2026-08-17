const UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/** Seconds as something worth showing a user: "15 minutes", "1 hour", "24 hours". */
export function secondsToHuman(seconds: number): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

  if (seconds < 60) return plural(Math.max(1, Math.round(seconds)), 'second');
  if (seconds < 3600) return plural(Math.ceil(seconds / 60), 'minute');
  if (seconds < 86400) return plural(Math.round(seconds / 3600), 'hour');
  return plural(Math.round(seconds / 86400), 'day');
}

/**
 * Turns a JWT-style duration ("15m", "30d", "900") into seconds. We need the numeric value
 * alongside the string: jsonwebtoken takes the string, while clients and Redis TTLs need the
 * number.
 */
export function durationToSeconds(value: string): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(value.trim());
  if (!match) throw new Error(`Invalid duration: "${value}" (expected e.g. 15m, 24h, 30d)`);

  const amount = Number(match[1]);
  const unit = match[2] ?? 's';
  return amount * (UNITS[unit] ?? 1);
}
