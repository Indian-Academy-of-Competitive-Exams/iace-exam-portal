import {
  BRANCH_TYPE,
  GROUP_TYPE,
  STUDENT_TYPE,
  type AdminPermissions,
  type BranchType,
  type GroupType,
  type PermissionLevel,
  type StudentType,
} from '@iace/contracts';
import { type Env } from '../../src/config/env.schema';
import { type AppConfigService } from '../../src/config/app-config.service';
import { type RedisService } from '../../src/redis/redis.service';
import { type PrismaService } from '../../src/prisma/prisma.service';
import { type StorageService } from '../../src/storage/storage.service';
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

    set: (
      key: string,
      value: string,
      mode?: string,
      ttlSec?: number,
      condition?: string,
    ): Promise<'OK' | null> => {
      if (condition === 'NX' && this.live(key)) return Promise.resolve(null);
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

  async acquireLock(key: string, ttlSec: number): Promise<boolean> {
    return (await this.client.set(key, '1', 'EX', ttlSec, 'NX')) === 'OK';
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

/**
 * In-memory `StorageService`, typed against the two methods it stands in for so a signature
 * drift here fails the build rather than surfacing as a confusing test failure.
 */
export class FakeStorage implements Pick<StorageService, 'upload' | 'objectSize' | 'read'> {
  objects = new Map<string, Buffer>();
  failNextUpload = false;
  private readonly reportedSizes = new Map<string, number>();

  upload(key: string, body: Buffer | Uint8Array | string, _contentType?: string) {
    if (this.failNextUpload) return Promise.reject(new Error('s3 is down'));
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body as Uint8Array | string);
    this.objects.set(key, buffer);
    return Promise.resolve({ key, url: `memory://${key}` });
  }

  /** Lets a test make `objectSize` disagree with what one specific key actually holds. */
  reportSize(key: string, size: number): void {
    this.reportedSizes.set(key, size);
  }

  objectSize(key: string): Promise<number | null> {
    if (this.reportedSizes.has(key)) return Promise.resolve(this.reportedSizes.get(key) ?? null);
    return Promise.resolve(this.objects.get(key)?.byteLength ?? null);
  }

  read(key: string): Promise<Buffer> {
    const object = this.objects.get(key);
    if (!object) return Promise.reject(new Error(`no object ${key}`));
    return Promise.resolve(object);
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
  readonly events: { name: DomainEventName; payload: Record<string, unknown> }[] = [];

  emit<K extends DomainEventName>(name: K, payload: DomainEventPayloads[K]): void {
    this.events.push({ name, payload: payload as unknown as Record<string, unknown> });
  }

  /** Every payload published under one name, in order. */
  of<K extends DomainEventName>(name: K): DomainEventPayloads[K][] {
    return this.events
      .filter((entry) => entry.name === name)
      .map((entry) => entry.payload as unknown as DomainEventPayloads[K]);
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
  studentType: StudentType;
  enrolledExams: string[];
  program: string | null;
  currentBranchId: string | null;
  preferredLanguage: string;
  preTestReady: boolean;
  profileCompleted: boolean;
  isActive: boolean;
  isTestBlocked: boolean;
  /** True while the student is still on the PIN the institute set for them. */
  pinIsDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
  profile: FakeProfile | null;
  /** The groups granted to this student — the column, as Prisma stores it. */
  directGroupIds: string[];
  deletedAt: Date | null;
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
    studentType: STUDENT_TYPE.ONLINE,
    enrolledExams: [],
    program: null,
    currentBranchId: null,
    preferredLanguage: 'en',
    preTestReady: false,
    profileCompleted: false,
    isActive: true,
    isTestBlocked: false,
    pinIsDefault: false,
    // Fixed, not `new Date()`: a summary serialises this and a moving value would
    // make an assertion on the payload untestable.
    createdAt: new Date('2026-01-05T09:30:00.000Z'),
    updatedAt: new Date('2026-01-05T09:30:00.000Z'),
    profile: null,
    directGroupIds: [],
    deletedAt: null,
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

/** The student filters the fakes answer: two `in` lookups, and the three ways a group reaches one. */
interface StudentWhere {
  id?: { in: string[] };
  mobile?: { in: string[] };
  directGroupIds?: { has: string };
  enrolledExams?: { has: string };
  deletedAt?: null;
}

function matchesStudent(student: FakeStudent, where: StudentWhere): boolean {
  return (
    (where.id?.in ? where.id.in.includes(student.id) : true) &&
    (where.mobile?.in ? where.mobile.in.includes(student.mobile) : true) &&
    (where.directGroupIds ? student.directGroupIds.includes(where.directGroupIds.has) : true) &&
    (where.enrolledExams ? student.enrolledExams.includes(where.enrolledExams.has) : true) &&
    (where.deletedAt === undefined ? true : student.deletedAt === null)
  );
}

/** Deep enough that mutating the original after this — `update` does, in place — leaves the
 * copy alone: the nested `profile` object and the `directGroupIds` array need their own copy. */
function cloneStudent(student: FakeStudent): FakeStudent {
  return {
    ...student,
    profile: student.profile ? { ...student.profile } : null,
    directGroupIds: [...student.directGroupIds],
  };
}

export interface FakeGroup {
  id: string;
  name: string;
  type: GroupType;
  examType: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  branches: { id: string; name: string; type: BranchType }[];
  _count: { testSeries: number };
}

export function makeGroup(overrides: Partial<FakeGroup> = {}): FakeGroup {
  return {
    id: 'grp_1',
    name: 'SSC CGL MORNING',
    // The type that takes a student one at a time: most fakes here are grant paths.
    type: GROUP_TYPE.SCHOLARSHIP,
    examType: null,
    description: null,
    isActive: true,
    createdAt: new Date('2026-01-05T09:30:00.000Z'),
    branches: [],
    ...overrides,
    // After the spread, so a caller passing only some fields still gets a count.
    _count: { testSeries: overrides._count?.testSeries ?? 0 },
  };
}

/** What the service writes: scalars, plus branches connected on create and replaced on update. */
interface GroupWriteData {
  name?: string;
  type?: GroupType;
  examType?: string | null;
  description?: string | null;
  isActive?: boolean;
  branches?: { connect?: { id: string }[]; set?: { id: string }[] };
}

/** An omitted field takes its column default — for every nullable column here, that is null. */
function omittedAsNull<T extends Record<string, unknown>>(data: T): T {
  const result = { ...data };
  for (const key of Object.keys(result)) {
    if (result[key as keyof T] === undefined) (result as Record<string, unknown>)[key] = null;
  }
  return result;
}

interface RowActionLogWhere {
  feature?: string;
  action?: string;
  entityId?: string;
  actorId?: string;
  createdAt?: { gte?: Date; lt?: Date; lte?: Date };
  id?: { gt?: string };
}

/** The archive job's day/cursor scan and the read API's filtered page share this one matcher. */
function matchesRowActionLog(row: Record<string, unknown>, where: RowActionLogWhere): boolean {
  const at = row.createdAt as Date;
  const id = row.id as string;
  return (
    (where.feature === undefined || row.feature === where.feature) &&
    (where.action === undefined || row.action === where.action) &&
    (where.entityId === undefined || row.entityId === where.entityId) &&
    (where.actorId === undefined || row.actorId === where.actorId) &&
    (where.createdAt?.gte === undefined || at >= where.createdAt.gte) &&
    (where.createdAt?.lt === undefined || at < where.createdAt.lt) &&
    (where.createdAt?.lte === undefined || at <= where.createdAt.lte) &&
    (where.id?.gt === undefined || id > where.id.gt)
  );
}

type OrderSpec = Record<string, 'asc' | 'desc' | undefined>;

/**
 * Prisma's `orderBy` takes one sort object or several, applied in order as tiebreakers — this
 * mirrors both shapes so a fake needs no bespoke sort for every new call site.
 */
function sortByKeys<T extends Record<string, unknown>>(
  rows: readonly T[],
  orderBy: OrderSpec | OrderSpec[] | undefined,
): T[] {
  let specs: OrderSpec[];
  if (orderBy === undefined) {
    specs = [];
  } else if (Array.isArray(orderBy)) {
    specs = orderBy;
  } else {
    specs = [orderBy];
  }
  const keys = specs.flatMap((spec) =>
    Object.entries(spec).filter(
      (entry): entry is [string, 'asc' | 'desc'] => entry[1] !== undefined,
    ),
  );
  if (keys.length === 0) return [...rows];

  return [...rows].sort((a, b) => {
    for (const [key, direction] of keys) {
      const [av, bv] = [a[key], b[key]];
      const cmp =
        av instanceof Date && bv instanceof Date
          ? av.getTime() - bv.getTime()
          : String(av).localeCompare(String(bv));
      if (cmp !== 0) return direction === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

/** Just enough Prisma for the auth service: find by unique key, and upsert. */
export class FakePrisma {
  private nextId = 1;

  constructor(
    readonly students: FakeStudent[] = [],
    readonly admins: FakeAdmin[] = [],
    readonly branches: FakeBranch[] = [],
    readonly groups: FakeGroup[] = [],
    // FIFTH, and nowhere else: every existing call is positional, so an earlier
    // slot silently rebinds four arrays across nine call sites with no type error.
    readonly examTypes: FakeExamType[] = [],
  ) {}

  /** Set by a test that needs the exam-type deletion blocker to see a blueprint or a test. */
  baseConfigCount = 0;
  testCount = 0;

  /** How many student writes to allow before the rest throw — a commit that dies mid-loop. */
  studentWriteLimit: number | null = null;
  private studentWrites = 0;

  private guardStudentWrite(): void {
    if (this.studentWriteLimit === null) return;
    this.studentWrites += 1;
    if (this.studentWrites > this.studentWriteLimit) {
      throw new Error('student write failed');
    }
  }

  readonly student = {
    // A copy, not the live row: `update` mutates in place, and a caller that reads a row
    // before writing to it — to diff before against after — must see it as it was.
    findUnique: ({ where }: { where: { id?: string; mobile?: string } }) => {
      const row = this.students.find((s) =>
        where.id ? s.id === where.id : s.mobile === where.mobile,
      );
      return Promise.resolve(row ? cloneStudent(row) : null);
    },

    /** `where.id.in`, `where.mobile.in` and a grant lookup — all the membership paths ask for. */
    findMany: ({ where = {} }: { where?: StudentWhere }) =>
      Promise.resolve(this.students.filter((s) => matchesStudent(s, where))),

    count: ({ where = {} }: { where?: StudentWhere } = {}) =>
      Promise.resolve(this.students.filter((s) => matchesStudent(s, where)).length),

    create: ({ data }: { data: Partial<FakeStudent> & { mobile: string } }) => {
      this.guardStudentWrite();
      const created = makeStudent({ ...data, id: `stu_new_${this.nextId++}` });
      this.students.push(created);
      return Promise.resolve(created);
    },

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
     * Enough of a nested write for the profile and grant paths: scalar columns are assigned,
     * `profile.upsert` creates the row or merges into it, and `directGroupIds` takes either a
     * whole array or a `push`, exactly as Prisma would.
     */
    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown> & {
        profile?: { upsert: { create: Partial<FakeProfile>; update: Partial<FakeProfile> } };
        directGroupIds?: string[] | { push: string };
      };
    }) => {
      this.guardStudentWrite();
      const student = this.students.find((s) => s.id === where.id);
      if (!student) throw new Error(`no student ${where.id}`);

      const { profile, directGroupIds, ...scalars } = data;
      Object.assign(student, scalars);

      if (Array.isArray(directGroupIds)) student.directGroupIds = [...directGroupIds];
      else if (directGroupIds) student.directGroupIds.push(directGroupIds.push);

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

    findMany: ({ where = {} }: { where?: { id?: { in: string[] } } } = {}) =>
      Promise.resolve(this.admins.filter((a) => !where.id?.in || where.id.in.includes(a.id))),
  };

  /** Groups as the write and grant paths use them — the membership itself lives on the student. */
  readonly group = {
    // A copy, not the live row — same reason as `student.findUnique` above: `update` mutates
    // the found row in place, and a before/after diff needs the "before" to hold still.
    findUnique: ({ where }: { where: { id: string } }) => {
      const row = this.groups.find((g) => g.id === where.id);
      return Promise.resolve(row ? { ...row } : null);
    },

    groupBy: ({ where = {} }: { where?: { examType?: { in: string[] } } } = {}) => {
      const wanted = where.examType?.in;
      const counts = new Map<string, number>();
      for (const g of this.groups) {
        if (g.examType === null) continue;
        if (wanted && !wanted.includes(g.examType)) continue;
        counts.set(g.examType, (counts.get(g.examType) ?? 0) + 1);
      }
      return Promise.resolve(
        [...counts].map(([examType, total]) => ({ examType, _count: { _all: total } })),
      );
    },

    findFirst: ({
      where,
    }: {
      where: { name?: string; examType?: string | null; id?: { not: string } };
    }) =>
      Promise.resolve(
        this.groups.find(
          (g) =>
            (where.name === undefined || g.name === where.name) &&
            (where.examType === undefined || g.examType === where.examType) &&
            (where.id?.not === undefined || g.id !== where.id.not),
        ) ?? null,
      ),

    findMany: ({
      where = {},
    }: { where?: { id?: { in: string[] }; type?: { in: GroupType[] } } } = {}) =>
      Promise.resolve(
        this.groups.filter(
          (g) =>
            (!where.id?.in || where.id.in.includes(g.id)) &&
            (!where.type?.in || where.type.in.includes(g.type)),
        ),
      ),

    count: ({
      where = {},
    }: {
      where?: { id?: { in: string[] }; examType?: string; type?: { notIn: GroupType[] } };
    } = {}) =>
      Promise.resolve(
        this.groups.filter(
          (g) =>
            (!where.id?.in || where.id.in.includes(g.id)) &&
            (where.examType === undefined || g.examType === where.examType) &&
            !where.type?.notIn?.includes(g.type),
        ).length,
      ),

    create: ({ data }: { data: GroupWriteData }) => {
      const { branches, ...scalars } = data;
      const created = makeGroup({
        ...scalars,
        id: `grp_new_${this.nextId++}`,
        branches: this.branchRefs((branches?.connect ?? []).map((branch) => branch.id)),
      });
      this.groups.push(created);
      return Promise.resolve(created);
    },

    update: ({ where, data }: { where: { id: string }; data: GroupWriteData }) => {
      const group = this.groups.find((g) => g.id === where.id);
      if (!group) throw new Error(`no group ${where.id}`);

      const { branches, ...scalars } = data;
      Object.assign(group, scalars);
      if (branches?.set) group.branches = this.branchRefs(branches.set.map((b) => b.id));
      return Promise.resolve(group);
    },

    delete: ({ where }: { where: { id: string } }) => {
      const index = this.groups.findIndex((g) => g.id === where.id);
      const [removed] = this.groups.splice(index, 1);
      return Promise.resolve(removed);
    },
  };

  private branchRefs(ids: string[]): { id: string; name: string; type: BranchType }[] {
    return ids.map((id) => {
      const branch = this.branches.find((candidate) => candidate.id === id);
      return { id, name: branch?.name ?? id, type: branch?.type ?? BRANCH_TYPE.PHYSICAL };
    });
  }

  /** Branches, with the group counts the service reads through `_count`. */
  readonly branch = {
    // A copy, not the live row — same reason as `student.findUnique` above.
    findUnique: ({ where }: { where: { id?: string; name?: string } }) => {
      const row = this.branches.find((b) => (where.id ? b.id === where.id : b.name === where.name));
      return Promise.resolve(row ? { ...row } : null);
    },

    findMany: ({
      where = {},
    }: { where?: { isActive?: boolean; name?: { contains: string } } } = {}) =>
      Promise.resolve(
        this.branches.filter(
          (b) =>
            (where.isActive === undefined || b.isActive === where.isActive) &&
            (where.name?.contains === undefined ||
              b.name.toLowerCase().includes(where.name.contains.toLowerCase())),
        ),
      ),

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

  /** Exam types, with the list filters and the CRUD `ExamTypesService` runs. */
  readonly examType = {
    // A copy, not the live row — same reason as `student.findUnique` above.
    findUnique: ({ where }: { where: { id?: string; name?: string; code?: string } }) => {
      const row = this.examTypes.find((e) => matchesExamTypeKey(e, where));
      return Promise.resolve(row ? { ...row } : null);
    },

    findMany: ({
      where = {},
      skip = 0,
      take,
    }: { where?: ExamTypeWhere; skip?: number; take?: number } = {}) => {
      const matched = this.examTypes.filter((e) => matchesExamType(e, where));
      return Promise.resolve(matched.slice(skip, take === undefined ? undefined : skip + take));
    },

    count: ({ where = {} }: { where?: ExamTypeWhere } = {}) =>
      Promise.resolve(this.examTypes.filter((e) => matchesExamType(e, where)).length),

    create: ({ data }: { data: { name: string; code: string } }) => {
      const created = makeExamType({ ...data, id: `ext_new_${this.nextId++}` });
      this.examTypes.push(created);
      return Promise.resolve(created);
    },

    update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const examType = this.examTypes.find((e) => e.id === where.id);
      if (!examType) throw new Error(`no exam type ${where.id}`);
      Object.assign(examType, data);
      return Promise.resolve(examType);
    },

    delete: ({ where }: { where: { id: string } }) => {
      const index = this.examTypes.findIndex((e) => e.id === where.id);
      const [removed] = this.examTypes.splice(index, 1);
      return Promise.resolve(removed);
    },
  };

  /** Nothing in this slice writes them; the deletion blocker only ever reads a count. */
  readonly baseConfig = { count: () => Promise.resolve(this.baseConfigCount) };
  readonly test = { count: () => Promise.resolve(this.testCount) };

  rowActionLogs: Array<Record<string, unknown>> = [];

  rowActionLog = {
    create: ({ data }: { data: Record<string, unknown> }) => {
      const row = {
        id: `ral_${this.rowActionLogs.length + 1}`,
        createdAt: new Date(),
        ...omittedAsNull(data),
      };
      this.rowActionLogs.push(row);
      return Promise.resolve(row);
    },
    createMany: ({ data }: { data: Array<Record<string, unknown>> }) => {
      for (const item of data)
        this.rowActionLogs.push({
          id: `ral_${this.rowActionLogs.length + 1}`,
          createdAt: new Date(),
          ...omittedAsNull(item),
        });
      return Promise.resolve({ count: data.length });
    },
    /**
     * Covers every call shape in play: the archive job's day-picker `createdAt.lt` scan and
     * `id`-cursor page, and the read API's filtered, skip/take page.
     */
    findMany: ({
      where = {},
      orderBy,
      skip = 0,
      take,
    }: {
      where?: RowActionLogWhere;
      orderBy?: OrderSpec | OrderSpec[];
      skip?: number;
      take?: number;
    } = {}) => {
      const rows = sortByKeys(
        this.rowActionLogs.filter((row) => matchesRowActionLog(row, where)),
        orderBy,
      );
      return Promise.resolve(take === undefined ? rows.slice(skip) : rows.slice(skip, skip + take));
    },
    count: ({ where = {} }: { where?: RowActionLogWhere } = {}) =>
      Promise.resolve(this.rowActionLogs.filter((row) => matchesRowActionLog(row, where)).length),
    /** A missing `gte`/`lt` is unbounded on that side, the way Postgres reads an omitted clause. */
    deleteMany: ({ where }: { where: { createdAt: { gte?: Date; lt?: Date } } }) => {
      const before = this.rowActionLogs.length;
      this.rowActionLogs = this.rowActionLogs.filter((row) => {
        const at = row.createdAt as Date;
        const inWindow =
          (where.createdAt.gte === undefined || at >= where.createdAt.gte) &&
          (where.createdAt.lt === undefined || at < where.createdAt.lt);
        return !inWindow;
      });
      return Promise.resolve({ count: before - this.rowActionLogs.length });
    },
  };

  importLogs: Array<Record<string, unknown>> = [];

  importLog = {
    create: ({ data }: { data: Record<string, unknown> }) => {
      const row = {
        id: `imp_${this.importLogs.length + 1}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...omittedAsNull(data),
      };
      this.importLogs.push(row);
      return Promise.resolve(row);
    },
    update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.importLogs.find((r) => r.id === where.id);
      if (!row) throw new Error(`no import log ${where.id}`);
      Object.assign(row, omittedAsNull(data));
      return Promise.resolve(row);
    },

    findMany: ({
      where = {},
      orderBy,
      skip = 0,
      take,
    }: {
      where?: { actorId?: string };
      orderBy?: OrderSpec | OrderSpec[];
      skip?: number;
      take?: number;
    } = {}) => {
      const rows = sortByKeys(
        this.importLogs.filter(
          (row) => where.actorId === undefined || row.actorId === where.actorId,
        ),
        orderBy,
      );
      return Promise.resolve(take === undefined ? rows.slice(skip) : rows.slice(skip, skip + take));
    },

    count: ({ where = {} }: { where?: { actorId?: string } } = {}) =>
      Promise.resolve(
        this.importLogs.filter(
          (row) => where.actorId === undefined || row.actorId === where.actorId,
        ).length,
      ),
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
  type: BranchType;
  isActive: boolean;
  createdAt: Date;
  _count: { groups: number };
}

export function makeBranch(overrides: Partial<FakeBranch> = {}): FakeBranch {
  return {
    id: 'br_1',
    name: 'AMEERPET',
    type: BRANCH_TYPE.PHYSICAL,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
    // After the spread, so a caller passing only some fields still gets a count.
    _count: { groups: overrides._count?.groups ?? 0 },
  };
}

export interface FakeExamType {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  createdAt: Date;
}

export function makeExamType(overrides: Partial<FakeExamType> = {}): FakeExamType {
  return {
    id: 'ext_1',
    name: 'SSC CGL',
    code: 'SSC CGL',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

interface ExamTypeWhere {
  name?: { contains: string; mode?: 'insensitive' };
  code?: { in: string[] };
  isActive?: boolean;
}

function matchesExamType(examType: FakeExamType, where: ExamTypeWhere): boolean {
  return (
    (where.name ? examType.name.toLowerCase().includes(where.name.contains.toLowerCase()) : true) &&
    (where.code ? where.code.in.includes(examType.code) : true) &&
    (where.isActive === undefined || examType.isActive === where.isActive)
  );
}

function matchesExamTypeKey(
  examType: FakeExamType,
  where: { id?: string; name?: string; code?: string },
): boolean {
  if (where.id !== undefined) return examType.id === where.id;
  if (where.name !== undefined) return examType.name === where.name;
  return examType.code === where.code;
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
    // A copy, not the live row: `update` mutates in place, and a caller that reads a row
    // before writing to it — to diff before against after — must see it as it was.
    findUnique: ({ where }: { where: { id?: string; email?: string } }) => {
      const row = this.admins.find((a) => (where.id ? a.id === where.id : a.email === where.email));
      return Promise.resolve(row ? { ...row } : null);
    },

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

// ============================================================================
// The question bank. Its own fake, like the admins one: the tables are unrelated
// to the roster's, and a shared class would only be two fakes in a trench coat.
// ============================================================================

export interface FakeSubjectRow {
  id: string;
  name: string;
  code: string | null;
}

export interface FakeTopicRow {
  id: string;
  name: string;
  subjectId: string;
}

export interface FakeSubTopicRow {
  id: string;
  name: string;
  topicIds: string[];
}

export interface FakeQuestionOptionRow {
  id: string;
  questionId: string;
  position: number;
  isCorrect: boolean;
  text: unknown;
}

export interface FakeQuestionRow {
  id: string;
  questionCode: string | null;
  type: string;
  subjectId: string;
  topicId: string | null;
  subTopicId: string | null;
  difficulty: string;
  status: string;
  isActive: boolean;
  content: unknown;
  answerKey: unknown;
  tags: string[];
  source: unknown;
  stemHash: string | null;
  defaultMarks: number | null;
  defaultNegativeMarks: number | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const FIXED_NOW = new Date('2026-08-18T06:00:00.000Z');

export function makeSubject(overrides: Partial<FakeSubjectRow> = {}): FakeSubjectRow {
  return { id: 'sub_1', name: 'QUANTITATIVE APTITUDE', code: null, ...overrides };
}

export function makeTopic(overrides: Partial<FakeTopicRow> = {}): FakeTopicRow {
  return { id: 'top_1', name: 'ARITHMETIC', subjectId: 'sub_1', ...overrides };
}

export function makeSubTopic(overrides: Partial<FakeSubTopicRow> = {}): FakeSubTopicRow {
  return { id: 'stp_1', name: 'PERCENTAGES', topicIds: ['top_1'], ...overrides };
}

export function makeQuestion(overrides: Partial<FakeQuestionRow> = {}): FakeQuestionRow {
  return {
    id: 'qst_1',
    questionCode: null,
    type: 'SINGLE_MCQ',
    subjectId: 'sub_1',
    topicId: 'top_1',
    subTopicId: null,
    difficulty: 'MEDIUM',
    status: 'ACTIVE',
    isActive: true,
    content: { en: { stem: [{ type: 'TEXT', text: 'What is 20% of 150?' }] } },
    answerKey: null,
    tags: [],
    source: null,
    stemHash: 'hash_1',
    defaultMarks: null,
    defaultNegativeMarks: null,
    createdById: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

interface FakeQuestionWhere {
  AND?: FakeQuestionWhere[];
  id?: string | { in?: string[]; not?: string };
  subjectId?: string;
  topicId?: string;
  subTopicId?: string;
  type?: string;
  difficulty?: string;
  status?: string;
  isActive?: boolean;
  stemHash?: string | { not?: null };
  tags?: { has?: string };
  content?: unknown;
}

export class FakeQuestionBankPrisma {
  private seq = 0;
  readonly options: FakeQuestionOptionRow[] = [];

  constructor(
    readonly questions: FakeQuestionRow[] = [],
    readonly subjects: FakeSubjectRow[] = [],
    readonly topics: FakeTopicRow[] = [],
    readonly subTopics: FakeSubTopicRow[] = [],
  ) {}

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  asService(): PrismaService {
    return this as unknown as PrismaService;
  }

  /** The array form, which is how every question-bank service calls it. */
  $transaction<T>(operations: Promise<T>[]): Promise<T[]> {
    return Promise.all(operations);
  }

  readonly importLogs: Array<Record<string, unknown>> = [];
  readonly rowActionLogs: Array<Record<string, unknown>> = [];

  /** What a question sheet's two steps touch: the preview opens the run, the commit closes it. */
  readonly importLog = {
    create: ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `imp_${this.importLogs.length + 1}`, ...data };
      this.importLogs.push(row);
      return Promise.resolve(row);
    },

    findUnique: ({ where }: { where: { id: string } }) =>
      Promise.resolve(this.importLogs.find((row) => row.id === where.id) ?? null),

    update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.importLogs.find((candidate) => candidate.id === where.id);
      if (!row) throw new Error(`no import log ${where.id}`);
      Object.assign(row, data);
      return Promise.resolve(row);
    },
  };

  readonly rowActionLog = {
    createMany: ({ data }: { data: Array<Record<string, unknown>> }) => {
      for (const item of data) {
        this.rowActionLogs.push({
          id: `ral_${this.rowActionLogs.length + 1}`,
          ...omittedAsNull(item),
        });
      }
      return Promise.resolve({ count: data.length });
    },
  };

  /** The search pre-filter. Tests that do not search never reach it. */
  $queryRaw(): Promise<{ id: string }[]> {
    return Promise.resolve(this.questions.map((row) => ({ id: row.id })));
  }

  readonly question = {
    findMany: ({
      where,
      skip = 0,
      take = 50,
    }: { where?: FakeQuestionWhere; skip?: number; take?: number } = {}) =>
      Promise.resolve(
        this.matching(where)
          .slice(skip, skip + take)
          .map((row) => this.hydrate(row)),
      ),

    count: ({ where }: { where?: FakeQuestionWhere } = {}) =>
      Promise.resolve(this.matching(where).length),

    findUnique: ({ where }: { where: { id: string } }) => {
      const row = this.questions.find((question) => question.id === where.id);
      return Promise.resolve(row ? this.hydrate(row) : null);
    },

    findFirst: ({ where }: { where?: FakeQuestionWhere } = {}) => {
      const row = this.matching(where)[0];
      return Promise.resolve(row ? this.hydrate(row) : null);
    },

    create: ({ data }: { data: Record<string, unknown> }) => {
      const row = makeQuestion({
        ...(data as Partial<FakeQuestionRow>),
        id: this.id('qst'),
        subjectId: subjectIdOf(data),
        topicId: relationIdOf(data, 'topic'),
        subTopicId: relationIdOf(data, 'subTopic'),
      });
      this.questions.push(row);
      this.writeOptions(row.id, data.options);
      return Promise.resolve(this.hydrate(row));
    },

    update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.questions.find((question) => question.id === where.id);
      if (!row) throw new Error(`no question ${where.id}`);
      const { options, subject, topic, subTopic, ...rest } = data;
      Object.assign(row, rest);
      if (subject) row.subjectId = subjectIdOf(data);
      if (topic !== undefined) row.topicId = relationIdOf(data, 'topic');
      if (subTopic !== undefined) row.subTopicId = relationIdOf(data, 'subTopic');
      if (options) this.writeOptions(row.id, options);
      return Promise.resolve(this.hydrate(row));
    },
  };

  readonly questionOption = {
    deleteMany: ({ where }: { where: { questionId: string } }) => {
      const kept = this.options.filter((option) => option.questionId !== where.questionId);
      this.options.length = 0;
      this.options.push(...kept);
      return Promise.resolve({ count: 0 });
    },
  };

  readonly subject = {
    findMany: ({ where }: { where?: { id?: { in: string[] } } } = {}) =>
      Promise.resolve(
        this.subjects
          .filter((row) => !where?.id?.in || where.id.in.includes(row.id))
          .map((row) => ({
            ...row,
            topics: this.topics
              .filter((topic) => topic.subjectId === row.id)
              .map((topic) => ({
                ...topic,
                subTopics: this.subTopics.filter((subTopic) =>
                  subTopic.topicIds.includes(topic.id),
                ),
              })),
          })),
      ),

    // A copy, not the live row — same reason as `FakePrisma.student.findUnique`.
    findUnique: ({ where }: { where: { id?: string; name?: string } }) => {
      const row = this.subjects.find((r) => (where.id ? r.id === where.id : r.name === where.name));
      return Promise.resolve(row ? { ...row } : null);
    },

    count: () => Promise.resolve(this.subjects.length),

    create: ({ data }: { data: { name: string; code?: string | null } }) => {
      const row = makeSubject({ id: this.id('sub'), name: data.name, code: data.code ?? null });
      this.subjects.push(row);
      return Promise.resolve({ ...row, _count: { topics: 0, questions: 0 } });
    },

    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: { name?: string; code?: string | null };
    }) => {
      const row = this.subjects.find((subject) => subject.id === where.id);
      if (!row) throw new Error(`no subject ${where.id}`);
      if (data.name !== undefined) row.name = data.name;
      if (data.code !== undefined) row.code = data.code;
      return Promise.resolve({
        ...row,
        _count: {
          topics: this.topics.filter((topic) => topic.subjectId === row.id).length,
          questions: this.questions.filter((question) => question.subjectId === row.id).length,
        },
      });
    },
  };

  readonly topic = {
    findMany: ({ where }: { where?: { id?: { in: string[] } } } = {}) =>
      Promise.resolve(this.topics.filter((row) => !where?.id?.in || where.id.in.includes(row.id))),

    // A copy, not the live row — same reason as `FakePrisma.student.findUnique`.
    findUnique: ({ where }: { where: { id: string } }) => {
      const row = this.topics.find((r) => r.id === where.id);
      return Promise.resolve(row ? { ...row } : null);
    },

    findFirst: ({ where }: { where: { subjectId?: string; name?: string } }) =>
      Promise.resolve(
        this.topics.find(
          (row) =>
            (where.subjectId === undefined || row.subjectId === where.subjectId) &&
            (where.name === undefined || row.name === where.name),
        ) ?? null,
      ),

    count: ({ where }: { where?: { id?: { in: string[] } } } = {}) =>
      Promise.resolve(
        this.topics.filter((row) => !where?.id?.in || where.id.in.includes(row.id)).length,
      ),

    update: ({ where, data }: { where: { id: string }; data: { name?: string } }) => {
      const row = this.topics.find((topic) => topic.id === where.id);
      if (!row) throw new Error(`no topic ${where.id}`);
      if (data.name !== undefined) row.name = data.name;
      const subject = this.subjects.find((candidate) => candidate.id === row.subjectId);
      return Promise.resolve({
        ...row,
        subject: subject ? { id: subject.id, name: subject.name } : { id: row.subjectId, name: '' },
        _count: {
          subTopics: this.subTopics.filter((subTopic) => subTopic.topicIds.includes(row.id)).length,
          questions: this.questions.filter((question) => question.topicId === row.id).length,
        },
      });
    },
  };

  readonly subTopic = {
    findMany: ({ where }: { where?: { id?: { in: string[] } } } = {}) =>
      Promise.resolve(
        this.subTopics
          .filter((row) => !where?.id?.in || where.id.in.includes(row.id))
          .map((row) => ({ ...row, topics: row.topicIds.map((id) => ({ id })) })),
      ),

    // A copy with its own `topics` array — the `include` the service asks for — not the live row:
    // same reason as `FakePrisma.student.findUnique`.
    findUnique: ({ where }: { where: { id?: string; name?: string } }) => {
      const row = this.subTopics.find((r) =>
        where.id ? r.id === where.id : r.name === where.name,
      );
      return Promise.resolve(row ? { ...row, topics: row.topicIds.map((id) => ({ id })) } : null);
    },

    findFirst: ({ where }: { where: { name?: string; id?: { not: string } } }) =>
      Promise.resolve(
        this.subTopics.find(
          (row) =>
            (where.name === undefined || row.name === where.name) &&
            (where.id?.not === undefined || row.id !== where.id.not),
        ) ?? null,
      ),

    count: () => Promise.resolve(this.subTopics.length),

    create: ({ data }: { data: { name: string; topics: { connect: { id: string }[] } } }) => {
      const row = makeSubTopic({
        id: this.id('stp'),
        name: data.name,
        topicIds: data.topics.connect.map((topic) => topic.id),
      });
      this.subTopics.push(row);
      return Promise.resolve(this.hydrateSubTopic(row));
    },

    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: { name?: string; topics?: { connect?: { id: string }[]; set?: { id: string }[] } };
    }) => {
      const row = this.subTopics.find((subTopic) => subTopic.id === where.id);
      if (!row) throw new Error(`no sub-topic ${where.id}`);
      if (data.name) row.name = data.name;
      if (data.topics?.set) row.topicIds = data.topics.set.map((topic) => topic.id);
      if (data.topics?.connect) {
        row.topicIds = [...new Set([...row.topicIds, ...data.topics.connect.map((t) => t.id)])];
      }
      return Promise.resolve(this.hydrateSubTopic(row));
    },
  };

  private writeOptions(questionId: string, options: unknown): void {
    const create = (
      options as { create?: { position: number; isCorrect: boolean; text: unknown }[] }
    )?.create;
    if (!create) return;

    for (const option of create) {
      this.options.push({ id: this.id('opt'), questionId, ...option });
    }
  }

  private hydrate(row: FakeQuestionRow) {
    const subject = this.subjects.find((candidate) => candidate.id === row.subjectId);
    const topic = this.topics.find((candidate) => candidate.id === row.topicId);
    const subTopic = this.subTopics.find((candidate) => candidate.id === row.subTopicId);

    return {
      ...row,
      subject: subject ? { id: subject.id, name: subject.name } : { id: row.subjectId, name: '' },
      topic: topic ? { id: topic.id, name: topic.name } : null,
      subTopic: subTopic ? { id: subTopic.id, name: subTopic.name } : null,
      options: this.options
        .filter((option) => option.questionId === row.id)
        .sort((a, b) => a.position - b.position),
    };
  }

  private hydrateSubTopic(row: FakeSubTopicRow) {
    return {
      ...row,
      topics: row.topicIds.map((id) => {
        const topic = this.topics.find((candidate) => candidate.id === id);
        const subject = this.subjects.find((candidate) => candidate.id === topic?.subjectId);
        return {
          id,
          name: topic?.name ?? '',
          subject: { id: subject?.id ?? '', name: subject?.name ?? '' },
        };
      }),
      _count: { questions: 0 },
    };
  }

  private matching(where: FakeQuestionWhere | undefined): FakeQuestionRow[] {
    return this.questions.filter((row) => matches(row, where));
  }
}

function idMatches(row: FakeQuestionRow, id: FakeQuestionWhere['id']): boolean {
  if (typeof id === 'string') return row.id === id;
  if (typeof id === 'object') {
    if (id.in && !id.in.includes(row.id)) return false;
    if (id.not && row.id === id.not) return false;
  }
  return true;
}

function stemHashMatches(row: FakeQuestionRow, stemHash: FakeQuestionWhere['stemHash']): boolean {
  if (typeof stemHash === 'string') return row.stemHash === stemHash;
  if (typeof stemHash === 'object' && stemHash.not === null) return row.stemHash !== null;
  return true;
}

type QuestionFieldCheck = (row: FakeQuestionRow, where: FakeQuestionWhere) => boolean;

const QUESTION_FIELD_CHECKS: readonly QuestionFieldCheck[] = [
  (row, where) => !where.subjectId || row.subjectId === where.subjectId,
  (row, where) => !where.topicId || row.topicId === where.topicId,
  (row, where) => !where.subTopicId || row.subTopicId === where.subTopicId,
  (row, where) => !where.type || row.type === where.type,
  (row, where) => !where.difficulty || row.difficulty === where.difficulty,
  (row, where) => !where.status || row.status === where.status,
  (row, where) => where.isActive === undefined || row.isActive === where.isActive,
  (row, where) => !where.tags?.has || row.tags.includes(where.tags.has),
];

function matches(row: FakeQuestionRow, where: FakeQuestionWhere | undefined): boolean {
  if (!where) return true;
  if (where.AND && !where.AND.every((clause) => matches(row, clause))) return false;

  return (
    idMatches(row, where.id) &&
    stemHashMatches(row, where.stemHash) &&
    QUESTION_FIELD_CHECKS.every((check) => check(row, where))
  );
}

function subjectIdOf(data: Record<string, unknown>): string {
  const connect = (data.subject as { connect?: { id: string } } | undefined)?.connect;
  return connect?.id ?? (data.subjectId as string) ?? 'sub_1';
}

function relationIdOf(data: Record<string, unknown>, key: 'topic' | 'subTopic'): string | null {
  const connect = (data[key] as { connect?: { id: string } } | undefined)?.connect;
  if (connect?.id) return connect.id;
  const direct = data[`${key}Id`];
  return typeof direct === 'string' ? direct : null;
}
