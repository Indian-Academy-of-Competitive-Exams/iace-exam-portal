import type { AdminPermissions, PermissionLevel } from '@iace/contracts';
import { type Env } from '../../src/config/env.schema';
import { type AppConfigService } from '../../src/config/app-config.service';
import { type RedisService } from '../../src/redis/redis.service';
import { type PrismaService } from '../../src/prisma/prisma.service';
import { type MessageSender, type OutboundMessage } from '../../src/common/messaging';
import { type DeviceContext } from '../../src/auth/auth.types';
import {
  type DomainEventBus,
  type DomainEventName,
  type DomainEventPayloads,
} from '../../src/common/events';

/** Test doubles for the three things the auth services touch: Redis, config and Postgres. */

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
export class FakeMessageSender implements MessageSender {
  readonly sent: OutboundMessage[] = [];

  send(message: OutboundMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }

  get lastMessage(): OutboundMessage {
    const last = this.sent.at(-1);
    if (!last) throw new Error('nothing was sent');
    return last;
  }

  /** The code out of the last OTP. */
  get lastCode(): string {
    const code = this.lastMessage.data?.code;
    if (typeof code !== 'string') throw new Error('no OTP was sent');
    return code;
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

/** Records what was published instead of publishing it. */
export class FakeEventBus {
  readonly published: { event: DomainEventName; payload: unknown }[] = [];

  emit<K extends DomainEventName>(event: K, payload: DomainEventPayloads[K]): void {
    this.published.push({ event, payload });
  }

  /** Every payload published under one name, in order. */
  of<K extends DomainEventName>(event: K): DomainEventPayloads[K][] {
    return this.published
      .filter((entry) => entry.event === event)
      .map((entry) => entry.payload as DomainEventPayloads[K]);
  }

  asService(): DomainEventBus {
    return this as unknown as DomainEventBus;
  }
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
     * Enough of a nested write for the profile paths: scalar columns are assigned, and
     * `profile.upsert` creates the row or merges into it exactly as Prisma would.
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

  /** Branches, with the group counts the service reads through `_count`. */
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

/** The device context every session-creating call needs. */
export const NO_DEVICE: DeviceContext = {
  deviceId: null,
  deviceName: null,
  ip: null,
  userAgent: null,
};

/**
 * The admins facade, as far as auth is concerned: one method returning the grant map that goes
 * into a token.
 */
export class FakeAdminsService {
  readonly calls: string[] = [];
  constructor(private readonly grants: Record<string, AdminPermissions> = {}) {}

  permissionsFor(adminId: string): Promise<AdminPermissions> {
    this.calls.push(adminId);
    return Promise.resolve(this.grants[adminId] ?? {});
  }
}

// --------------------------------------------------------------------------- Admins / features /
// grants ---------------------------------------------------------------------------

interface FakeFeatureRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface FakePermissionRow {
  id: string;
  featureId: string;
  level: PermissionLevel;
  adminIds: string[];
}

interface FakeAdminRow {
  id: string;
  email: string;
  fullName: string | null;
  isSuperAdmin: boolean;
  isActive: boolean;
  createdById: string | null;
  createdAt: Date;
}

/** Enough Prisma for AdminsService to run unchanged, with no database. */
export class FakeAdminsPrisma {
  private seq = 0;
  readonly features: FakeFeatureRow[] = [];
  readonly permissions: FakePermissionRow[] = [];

  constructor(readonly admins: FakeAdminRow[] = []) {}

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  asService(): PrismaService {
    return this as unknown as PrismaService;
  }

  $transaction<T>(fn: (tx: FakeAdminsPrisma) => Promise<T>): Promise<T> {
    return fn(this);
  }

  readonly admin = {
    findUnique: ({ where }: { where: { id?: string; email?: string } }) =>
      Promise.resolve(
        this.admins.find((a) => (where.id ? a.id === where.id : a.email === where.email)) ?? null,
      ),

    findFirst: ({ where }: { where: { id: string } }) =>
      Promise.resolve(this.admins.find((a) => a.id === where.id) ?? null),

    findMany: ({ skip = 0, take = 50 }: { skip?: number; take?: number } = {}) =>
      Promise.resolve(this.admins.slice(skip, skip + take)),

    count: () => Promise.resolve(this.admins.length),

    create: ({ data }: { data: Partial<FakeAdminRow> & { email: string } }) => {
      const row: FakeAdminRow = {
        id: this.id('adm'),
        email: data.email,
        fullName: data.fullName ?? null,
        isSuperAdmin: data.isSuperAdmin ?? false,
        isActive: true,
        createdById: data.createdById ?? null,
        createdAt: new Date(),
      };
      this.admins.push(row);
      return Promise.resolve(row);
    },

    update: ({ where, data }: { where: { id: string }; data: Partial<FakeAdminRow> }) => {
      const row = this.admins.find((a) => a.id === where.id);
      if (!row) throw new Error(`no admin ${where.id}`);
      Object.assign(row, data);
      return Promise.resolve(row);
    },
  };

  readonly feature = {
    findUnique: ({ where }: { where: { key?: string; id?: string } }) =>
      Promise.resolve(
        this.features.find((f) => (where.key ? f.key === where.key : f.id === where.id)) ?? null,
      ),

    findUniqueOrThrow: ({ where }: { where: { id: string } }) => {
      const row = this.features.find((f) => f.id === where.id);
      if (!row) throw new Error(`no feature ${where.id}`);
      return Promise.resolve(this.withPermissions(row));
    },

    findMany: () =>
      Promise.resolve(
        [...this.features]
          .sort((a, b) => a.key.localeCompare(b.key))
          .map((f) => this.withPermissions(f)),
      ),

    create: ({
      data,
    }: {
      data: {
        key: string;
        name: string;
        description: string | null;
        permissions: { create: { level: PermissionLevel }[] };
      };
    }) => {
      const row: FakeFeatureRow = {
        id: this.id('ftr'),
        key: data.key,
        name: data.name,
        description: data.description,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.features.push(row);
      for (const p of data.permissions.create) {
        this.permissions.push({
          id: this.id('perm'),
          featureId: row.id,
          level: p.level,
          adminIds: [],
        });
      }
      return Promise.resolve(this.withPermissions(row));
    },
  };

  readonly featurePermission = {
    findMany: ({
      where,
    }: {
      where: { adminIds?: { has?: string; hasSome?: string[] } };
    }): Promise<
      { id: string; level: PermissionLevel; adminIds: string[]; feature: { key: string } }[]
    > => {
      const has = where.adminIds?.has;
      const hasSome = where.adminIds?.hasSome;
      return Promise.resolve(
        this.permissions
          .filter((p) =>
            has !== undefined
              ? p.adminIds.includes(has)
              : (hasSome ?? []).some((id) => p.adminIds.includes(id)),
          )
          .map((p) => ({
            id: p.id,
            level: p.level,
            adminIds: [...p.adminIds],
            feature: { key: this.features.find((f) => f.id === p.featureId)?.key ?? '' },
          })),
      );
    },

    findUnique: ({
      where,
    }: {
      where: { featureId_level: { featureId: string; level: PermissionLevel } };
    }) => {
      const { featureId, level } = where.featureId_level;
      const row = this.permissions.find((p) => p.featureId === featureId && p.level === level);
      return Promise.resolve(row ? { id: row.id, adminIds: [...row.adminIds] } : null);
    },

    update: ({ where, data }: { where: { id: string }; data: { adminIds: string[] } }) => {
      const row = this.permissions.find((p) => p.id === where.id);
      if (!row) throw new Error(`no permission ${where.id}`);
      row.adminIds = data.adminIds;
      return Promise.resolve(row);
    },
  };

  private withPermissions(row: FakeFeatureRow) {
    return {
      ...row,
      permissions: this.permissions
        .filter((p) => p.featureId === row.id)
        .map((p) => ({ level: p.level, adminIds: [...p.adminIds] })),
    };
  }
}

export function makeAdminRow(overrides: Partial<FakeAdminRow> = {}): FakeAdminRow {
  return {
    id: 'adm_1',
    email: 'admin@iace.co.in',
    fullName: 'An Admin',
    isSuperAdmin: false,
    isActive: true,
    createdById: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}
