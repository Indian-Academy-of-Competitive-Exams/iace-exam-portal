import { type Env } from '../../src/config/env.schema';
import { type AppConfigService } from '../../src/config/app-config.service';
import { type RedisService } from '../../src/redis/redis.service';
import { type PrismaService } from '../../src/prisma/prisma.service';
import { type OtpDelivery, type OtpSender } from '../../src/auth/otp/otp-sender';
import { type DeviceContext } from '../../src/auth/auth.types';

/**
 * Test doubles for the three things the auth services touch: Redis, config and
 * Postgres. They are hand-written rather than mocked so the suite needs no
 * running infrastructure — the same property the envelope tests have, and the
 * reason `pnpm test` is safe to put in CI on day one.
 *
 * The Redis fake models TTL against a clock the test controls, so expiry is
 * asserted by advancing time rather than by sleeping.
 */

interface Entry {
  value: string | Set<string>;
  expiresAtMs: number | null;
}

export class FakeRedis {
  private readonly store = new Map<string, Entry>();
  private nowMs = 1_700_000_000_000;

  /** Move the clock forward; keys past their TTL disappear exactly as Redis would. */
  advanceSeconds(seconds: number): void {
    this.nowMs += seconds * 1000;
  }

  /** Everything currently stored — lets a test assert what was persisted. */
  snapshot(): Record<string, string | string[]> {
    const out: Record<string, string | string[]> = {};
    for (const [key, entry] of this.store) {
      if (this.expired(entry)) continue;
      out[key] = entry.value instanceof Set ? [...entry.value] : entry.value;
    }
    return out;
  }

  private expired(entry: Entry): boolean {
    return entry.expiresAtMs !== null && entry.expiresAtMs <= this.nowMs;
  }

  private live(key: string): Entry | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (this.expired(entry)) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  private text(key: string): string | undefined {
    const entry = this.live(key);
    return typeof entry?.value === 'string' ? entry.value : undefined;
  }

  // --- the ioredis surface the services actually use ------------------------

  readonly client = {
    get: (key: string): Promise<string | null> => Promise.resolve(this.text(key) ?? null),

    set: (key: string, value: string, mode?: string, ttlSec?: number): Promise<'OK'> => {
      this.store.set(key, {
        value,
        expiresAtMs: mode === 'EX' && ttlSec ? this.nowMs + ttlSec * 1000 : null,
      });
      return Promise.resolve('OK');
    },

    incr: (key: string): Promise<number> => {
      const next = Number(this.text(key) ?? '0') + 1;
      const existing = this.live(key);
      this.store.set(key, { value: String(next), expiresAtMs: existing?.expiresAtMs ?? null });
      return Promise.resolve(next);
    },

    expire: (key: string, ttlSec: number): Promise<number> => {
      const entry = this.live(key);
      if (!entry) return Promise.resolve(0);
      entry.expiresAtMs = this.nowMs + ttlSec * 1000;
      return Promise.resolve(1);
    },

    exists: (key: string): Promise<number> => Promise.resolve(this.live(key) ? 1 : 0),

    del: (...keys: string[]): Promise<number> => {
      let removed = 0;
      for (const key of keys) if (this.store.delete(key)) removed += 1;
      return Promise.resolve(removed);
    },

    ttl: (key: string): Promise<number> => {
      const entry = this.live(key);
      if (!entry) return Promise.resolve(-2);
      if (entry.expiresAtMs === null) return Promise.resolve(-1);
      return Promise.resolve(Math.ceil((entry.expiresAtMs - this.nowMs) / 1000));
    },

    sadd: (key: string, member: string): Promise<number> => {
      const entry = this.live(key);
      const set = entry?.value instanceof Set ? entry.value : new Set<string>();
      const had = set.has(member);
      set.add(member);
      this.store.set(key, { value: set, expiresAtMs: entry?.expiresAtMs ?? null });
      return Promise.resolve(had ? 0 : 1);
    },

    srem: (key: string, member: string): Promise<number> => {
      const entry = this.live(key);
      if (!(entry?.value instanceof Set)) return Promise.resolve(0);
      return Promise.resolve(entry.value.delete(member) ? 1 : 0);
    },

    smembers: (key: string): Promise<string[]> => {
      const entry = this.live(key);
      return Promise.resolve(entry?.value instanceof Set ? [...entry.value] : []);
    },
  };

  // --- the typed helpers RedisService adds on top ---------------------------

  setJson(key: string, value: unknown, ttlSec: number): Promise<void> {
    return this.client.set(key, JSON.stringify(value), 'EX', ttlSec).then(() => undefined);
  }

  getJson<T>(key: string): Promise<T | null> {
    const raw = this.text(key);
    return Promise.resolve(raw === undefined ? null : (JSON.parse(raw) as T));
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length > 0) await this.client.del(...keys);
  }

  async ttl(key: string): Promise<number> {
    const ttl = await this.client.ttl(key);
    return Math.max(ttl, 0);
  }

  asService(): RedisService {
    return this as unknown as RedisService;
  }
}

// ---------------------------------------------------------------------------

const DEFAULT_ENV = {
  NODE_ENV: 'development',
  JWT_ACCESS_SECRET: 'access-secret-that-is-long-enough-000',
  JWT_REFRESH_SECRET: 'refresh-secret-that-is-long-enough-00',
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '30d',
  OTP_LENGTH: 6,
  OTP_TTL_SEC: 300,
  OTP_RESEND_COOLDOWN_SEC: 45,
  OTP_MAX_VERIFY_ATTEMPTS: 5,
  OTP_SENDER: 'console',
  PIN_PEPPER: 'pin-pepper-that-is-long-enough-000000',
  PIN_MAX_ATTEMPTS: 5,
  PIN_LOCKOUT_STEPS_SEC: [900, 3600, 86400],
  PIN_LOCKOUT_DECAY_SEC: 86400,
  PIN_SETUP_TTL_SEC: 600,
} as const;

export class FakeConfig {
  private readonly env: Record<string, unknown>;

  constructor(overrides: Partial<Record<keyof Env, unknown>> = {}) {
    this.env = { ...DEFAULT_ENV, ...overrides };
  }

  get<K extends keyof Env>(key: K): Env[K] {
    return this.env[key as string] as Env[K];
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get isDevelopment(): boolean {
    return this.env.NODE_ENV === 'development';
  }

  asService(): AppConfigService {
    return this as unknown as AppConfigService;
  }
}

// ---------------------------------------------------------------------------

/** Captures what would have been sent, so a test can read the code back. */
export class FakeOtpSender implements OtpSender {
  readonly sent: OtpDelivery[] = [];

  send(delivery: OtpDelivery): Promise<void> {
    this.sent.push(delivery);
    return Promise.resolve();
  }

  get lastCode(): string {
    const last = this.sent.at(-1);
    if (!last) throw new Error('no OTP was sent');
    return last.code;
  }
}

// ---------------------------------------------------------------------------

/** The `StudentProfile` columns the flags and the document writes look at. */
export interface FakeProfile {
  motherName: string | null;
  fatherName: string | null;
  dob: Date | null;
  gender: string | null;
  photoUrl: string | null;
  aadhaarUrl: string | null;
  panUrl: string | null;
}

export interface FakeStudent {
  id: string;
  mobile: string;
  pinHash: string | null;
  fullName: string | null;
  preferredLanguage: string;
  preTestReady: boolean;
  profileCompleted: boolean;
  isActive: boolean;
  profile: FakeProfile | null;
}

export function makeProfile(overrides: Partial<FakeProfile> = {}): FakeProfile {
  return {
    motherName: null,
    fatherName: null,
    dob: null,
    gender: null,
    photoUrl: null,
    aadhaarUrl: null,
    panUrl: null,
    ...overrides,
  };
}

export interface FakeAdmin {
  id: string;
  email: string;
  fullName: string | null;
  isSuperAdmin: boolean;
  isActive: boolean;
  pages: { code: string }[];
}

export function makeStudent(overrides: Partial<FakeStudent> = {}): FakeStudent {
  return {
    id: 'stu_1',
    mobile: '9876543210',
    pinHash: null,
    fullName: null,
    preferredLanguage: 'en',
    preTestReady: false,
    profileCompleted: false,
    isActive: true,
    profile: null,
    ...overrides,
  };
}

export function makeAdmin(overrides: Partial<FakeAdmin> = {}): FakeAdmin {
  return {
    id: 'adm_1',
    email: 'admin@iace.co.in',
    fullName: 'Super Admin',
    isSuperAdmin: true,
    isActive: true,
    pages: [],
    ...overrides,
  };
}

/** Just enough Prisma for the auth service: find by unique key, and upsert. */
export class FakePrisma {
  private nextId = 1;

  constructor(
    readonly students: FakeStudent[] = [],
    readonly admins: FakeAdmin[] = [],
    readonly branches: FakeBranch[] = [],
  ) {}

  readonly student = {
    findUnique: ({ where }: { where: { id?: string; mobile?: string } }) =>
      Promise.resolve(
        this.students.find((s) => (where.id ? s.id === where.id : s.mobile === where.mobile)) ??
          null,
      ),

    upsert: ({
      where,
      create,
      update,
    }: {
      where: { mobile: string };
      create: Partial<FakeStudent> & { mobile: string };
      update: Partial<FakeStudent>;
    }) => {
      const existing = this.students.find((s) => s.mobile === where.mobile);
      if (existing) {
        Object.assign(existing, update);
        return Promise.resolve(existing);
      }
      const created = makeStudent({ ...create, id: `stu_new_${this.nextId++}` });
      this.students.push(created);
      return Promise.resolve(created);
    },

    /**
     * Enough of a nested write for the profile paths: scalar columns are
     * assigned, and `profile.upsert` creates the row or merges into it exactly
     * as Prisma would. Modelled rather than stubbed because the thing worth
     * asserting — "storing a document recomputes `profileCompleted` from the
     * MERGED profile" — is invisible if the fake just records the call.
     */
    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown> & {
        profile?: { upsert: { create: Partial<FakeProfile>; update: Partial<FakeProfile> } };
      };
    }) => {
      const student = this.students.find((s) => s.id === where.id);
      if (!student) throw new Error(`no student ${where.id}`);

      const { profile, ...scalars } = data;
      Object.assign(student, scalars);

      if (profile) {
        student.profile = student.profile
          ? Object.assign(student.profile, profile.upsert.update)
          : makeProfile(profile.upsert.create);
      }
      return Promise.resolve(student);
    },
  };

  readonly admin = {
    findUnique: ({ where }: { where: { id?: string; email?: string } }) =>
      Promise.resolve(
        this.admins.find((a) => (where.id ? a.id === where.id : a.email === where.email)) ?? null,
      ),
  };

  /**
   * Branches, with the group counts the service reads through `_count`.
   *
   * Enough of Prisma's shape for BranchesService to run unchanged — the point
   * is to exercise the RULES (GLOBAL is protected, a branch with groups cannot
   * be deleted, a duplicate name is refused) without a database. Anything the
   * service does not call is deliberately absent rather than stubbed.
   */
  readonly branch = {
    findUnique: ({ where }: { where: { id?: string; name?: string } }) =>
      Promise.resolve(
        this.branches.find((b) => (where.id ? b.id === where.id : b.name === where.name)) ?? null,
      ),

    findMany: () => Promise.resolve([...this.branches]),

    count: () => Promise.resolve(this.branches.length),

    create: ({ data }: { data: { name: string } }) => {
      const created = makeBranch({ ...data, id: `br_new_${this.nextId++}` });
      this.branches.push(created);
      return Promise.resolve(created);
    },

    update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const branch = this.branches.find((b) => b.id === where.id);
      if (!branch) throw new Error(`no branch ${where.id}`);
      Object.assign(branch, data);
      return Promise.resolve(branch);
    },

    delete: ({ where }: { where: { id: string } }) => {
      const index = this.branches.findIndex((b) => b.id === where.id);
      const [removed] = this.branches.splice(index, 1);
      return Promise.resolve(removed);
    },
  };

  /** The service reads and counts in one transaction; order is preserved. */
  $transaction = (operations: Promise<unknown>[]) => Promise.all(operations);

  asService(): PrismaService {
    return this as unknown as PrismaService;
  }
}

export interface FakeBranch {
  id: string;
  name: string;
  isGlobal: boolean;
  isActive: boolean;
  createdAt: Date;
  _count: { groups: number };
}

export function makeBranch(overrides: Partial<FakeBranch> = {}): FakeBranch {
  return {
    id: 'br_1',
    name: 'AMEERPET',
    isGlobal: false,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
    // After the spread, so a caller passing only some fields still gets a count.
    _count: { groups: overrides._count?.groups ?? 0 },
  };
}

/**
 * The device context every session-creating call needs. Typed as DeviceContext
 * rather than inferred, so `{ ...NO_DEVICE, deviceId: 'phone-a' }` is allowed —
 * inference would fix each field to the literal `null`.
 */
export const NO_DEVICE: DeviceContext = {
  deviceId: null,
  deviceName: null,
  ip: null,
  userAgent: null,
};
