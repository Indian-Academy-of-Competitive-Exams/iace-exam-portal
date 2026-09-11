/** The only policy this platform can run on: a live sitting, every session and every OTP live in Redis. */
export const NO_EVICTION = 'noeviction';

export interface EvictionRisk {
  /** True when Redis told us a policy that will drop keys, which is a refusal to boot in production. */
  fatal: boolean;
  message: string;
}

/** Null when the policy is safe. A policy we could not read is a warning; a wrong one is not. */
export function evictionRisk(policy: string | null): EvictionRisk | null {
  if (policy === NO_EVICTION) return null;

  if (policy === null) {
    return {
      fatal: false,
      message: `Redis would not report maxmemory-policy — check by hand that it is "${NO_EVICTION}".`,
    };
  }

  return {
    fatal: true,
    message: `Redis maxmemory-policy is "${policy}", not "${NO_EVICTION}" — an eviction under memory pressure silently drops a sitting mid-exam.`,
  };
}
