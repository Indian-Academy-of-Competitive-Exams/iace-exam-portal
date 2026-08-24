import {
  AppException,
  ErrorCodes,
  BRANCH_TYPE,
  EXAM_FAMILY,
  EXAM_MODE,
  LANGUAGE_CODE,
  LANGUAGE_MODE,
  MERIT_TYPE,
  NAVIGATION_POLICY,
  STAGE_DISPOSITION,
  STUDENT_TYPE,
  UNLOCK_MODE,
  UNLOCK_REQUEST_STATUS,
  TEST_STATUS,
  TEST_UI,
  TIMER_TEMPLATE,
  type AdminPermissions,
  type BranchType,
  type ExamFamily,
  type ExamMode,
  type FeatureKey,
  type LanguageCode,
  type LanguageMode,
  type MeritType,
  type NavigationPolicy,
  type PermissionLevel,
  type StageDisposition,
  type StudentType,
  type UnlockMode,
  type UnlockRequestStatus,
  type NotificationType,
  type TestStatus,
  type TestUi,
  type TimerTemplate,
} from '@iace/contracts';
import { Prisma } from '@prisma/client';
import { type Env } from '../../src/config/env.schema';
import { type AppConfigService } from '../../src/config/app-config.service';
import { type RedisService } from '../../src/redis/redis.service';
import { type PrismaService } from '../../src/prisma/prisma.service';
import { type StorageService } from '../../src/storage/storage.service';
import { type MessageSender, type OutboundMessage } from '../../src/common/messaging';
import { type DeviceContext } from '../../src/auth/auth.types';
import { type AuthService } from '../../src/auth/auth.service';
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

    mget: (...keys: string[]): Promise<(string | null)[]> =>
      Promise.resolve(keys.map((key) => this.text(key) ?? null)),

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
export class FakeStorage implements Pick<
  StorageService,
  'upload' | 'objectSize' | 'read' | 'createDownloadUrl'
> {
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

  /** The ttl is in the string so a test can assert one was asked for, not just that a url came back. */
  createDownloadUrl(key: string, expiresInSec = 900): Promise<string> {
    return Promise.resolve(`memory://${key}?ttl=${expiresInSec}`);
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
  aadhaarVerified: boolean;
  panVerified: boolean;
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
  enrolledFamilies: ExamFamily[];
  programs: string[];
  currentBranchId: string | null;
  preTestReady: boolean;
  profileCompleted: boolean;
  isActive: boolean;
  isTestBlocked: boolean;
  /** True while the student is still on the PIN the institute set for them. */
  pinIsDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
  profile: FakeProfile | null;
  deletedAt: Date | null;
}

export function makeProfile(overrides: Partial<FakeProfile> = {}): FakeProfile {
  return {
    motherName: null,
    fatherName: null,
    dob: null,
    gender: null,
    photoUrl: null,
    aadhaarVerified: false,
    panVerified: false,
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
    enrolledFamilies: [],
    programs: [],
    currentBranchId: null,
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

/** The student filters the fakes answer: the `in` lookups, an enrolment, and live-only. */
interface StudentWhere {
  id?: string | { in: string[] };
  mobile?: string | { in: string[] };
  enrolledExams?: { has: string };
  deletedAt?: null;
}

function matchesStudent(student: FakeStudent, where: StudentWhere): boolean {
  return (
    matchesKey(student.id, where.id) &&
    matchesKey(student.mobile, where.mobile) &&
    (where.enrolledExams ? student.enrolledExams.includes(where.enrolledExams.has) : true) &&
    (where.deletedAt === undefined ? true : student.deletedAt === null)
  );
}

/** What Prisma accepts for a scalar column here: the value, a set to be one of, or a value to not be. */
type KeyFilter = string | { in: string[] } | { not: string };

/** Loud, because the silence is the bug: an unread key matches everything and the test still passes. */
function onlyUnderstands(where: object, known: readonly string[], matcher: string): void {
  const unknown = Object.keys(where).filter((key) => !known.includes(key));
  if (unknown.length === 0) return;
  throw new Error(
    `${matcher} was handed ${unknown.join(', ')}, which it ignores. Teach it those keys, ` +
      `or the test is asserting against a query the service no longer builds.`,
  );
}

/** Prisma's AND/OR: a flat matcher handed a nested `where` reads every field as undefined. */
function matchesTree<W extends { AND?: W[]; OR?: W[] }>(
  where: W,
  leaf: (clause: W) => boolean,
): boolean {
  if (where.AND && !where.AND.every((clause) => matchesTree(clause, leaf))) return false;
  if (where.OR && !where.OR.some((clause) => matchesTree(clause, leaf))) return false;
  return leaf(where);
}

function matchesKey(value: string, filter: KeyFilter | undefined): boolean {
  if (filter === undefined) return true;
  if (typeof filter === 'string') return value === filter;
  return 'not' in filter ? value !== filter.not : filter.in.includes(value);
}

/** Deep enough that mutating the original after this — `update` does, in place — leaves the
 * copy alone: the nested `profile` object needs its own copy. */
function cloneStudent(student: FakeStudent): FakeStudent {
  return { ...student, profile: student.profile ? { ...student.profile } : null };
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
  AND?: RowActionLogWhere[];
  OR?: RowActionLogWhere[];
  feature?: KeyFilter;
  action?: KeyFilter;
  entityId?: string;
  actorId?: KeyFilter;
  createdAt?: { gte?: Date; lt?: Date; lte?: Date };
  id?: { gt?: string };
}

/** The archive job's day/cursor scan and the read API's filtered page share this one matcher. */
const ROW_ACTION_WHERE_KEYS = [
  'AND',
  'OR',
  'feature',
  'action',
  'entityId',
  'actorId',
  'createdAt',
  'id',
] as const;

function matchesRowActionLog(row: Record<string, unknown>, where: RowActionLogWhere): boolean {
  const at = row.createdAt as Date;
  const id = row.id as string;
  return matchesTree(where, (clause) => {
    onlyUnderstands(clause, ROW_ACTION_WHERE_KEYS, 'The audit fake');
    return (
      matchesKey(row.feature as string, clause.feature) &&
      matchesKey(row.action as string, clause.action) &&
      (clause.entityId === undefined || row.entityId === clause.entityId) &&
      matchesKey(row.actorId as string, clause.actorId) &&
      (clause.createdAt?.gte === undefined || at >= clause.createdAt.gte) &&
      (clause.createdAt?.lt === undefined || at < clause.createdAt.lt) &&
      (clause.createdAt?.lte === undefined || at <= clause.createdAt.lte) &&
      (clause.id?.gt === undefined || id > clause.id.gt)
    );
  });
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
    readonly exams: FakeExam[] = [],
    readonly examStages: FakeExamStage[] = [],
  ) {}

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
    findUnique: ({ where }: { where: { id: string } }) => {
      const row = this.students.find((s) => s.id === where.id);
      return Promise.resolve(row ? cloneStudent(row) : null);
    },

    /** `mobile` is unique only among live rows, so every lookup by it is a filtered read. */
    findFirst: ({ where = {} }: { where?: StudentWhere } = {}) => {
      const row = this.students.find((s) => matchesStudent(s, where));
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

    /**
     * Enough of a nested write for the profile path: scalar columns are assigned, and
     * `profile.upsert` creates the row or merges into it, exactly as Prisma would.
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
      this.guardStudentWrite();
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

    findMany: ({ where = {} }: { where?: { id?: { in: string[] } } } = {}) =>
      Promise.resolve(this.admins.filter((a) => !where.id?.in || where.id.in.includes(a.id))),
  };

  /** Branches, with the student counts the service reads through `_count`. */
  readonly branch = {
    // A copy, not the live row — same reason as `student.findUnique` above.
    findUnique: ({ where }: { where: { id: string } }) => {
      const row = this.branches.find((b) => b.id === where.id);
      return Promise.resolve(row ? { ...row } : null);
    },

    /** `name` is unique only among live rows, so a lookup by it is a filtered read. */
    findFirst: ({ where }: { where: { name?: string; type?: BranchType; deletedAt?: null } }) => {
      const row = this.branches.find(
        (b) =>
          (where.name === undefined || b.name === where.name) &&
          (where.type === undefined || b.type === where.type),
      );
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

    create: ({ data }: { data: { name: string; type?: BranchType } }) => {
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

  /** The exam catalog, with the list filters and the CRUD `ExamsService` runs. */
  /** The program catalog the importer checks a roster's codes against. Set directly on the fake. */
  programCatalog: { code: string; isActive: boolean }[] = [];

  readonly program = {
    findMany: ({ where = {} }: { where?: { isActive?: boolean } } = {}) =>
      Promise.resolve(
        this.programCatalog.filter(
          (row) => where.isActive === undefined || row.isActive === where.isActive,
        ),
      ),
  };

  readonly exam = {
    // A copy, not the live row — same reason as `student.findUnique` above.
    findUnique: ({ where }: { where: { id?: string; code?: string } }) => {
      const row = this.exams.find((e) =>
        where.id === undefined ? e.code === where.code : e.id === where.id,
      );
      return Promise.resolve(row ? { ...row } : null);
    },

    findFirst: ({ where }: { where: { name?: string } }) =>
      Promise.resolve(this.exams.find((e) => e.name === where.name) ?? null),

    findMany: ({
      where = {},
      skip = 0,
      take,
    }: { where?: ExamWhere; skip?: number; take?: number } = {}) => {
      const matched = this.exams.filter((e) => matchesExam(e, where));
      return Promise.resolve(matched.slice(skip, take === undefined ? undefined : skip + take));
    },

    count: ({ where = {} }: { where?: ExamWhere } = {}) =>
      Promise.resolve(this.exams.filter((e) => matchesExam(e, where)).length),

    create: ({ data }: { data: Partial<FakeExam> & { name: string; code: string } }) => {
      const created = makeExam({ ...data, id: `exam_new_${this.nextId++}` });
      this.exams.push(created);
      return Promise.resolve(created);
    },

    update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const exam = this.exams.find((e) => e.id === where.id);
      if (!exam) throw new Error(`no exam ${where.id}`);
      Object.assign(exam, data);
      return Promise.resolve(exam);
    },

    delete: ({ where }: { where: { id: string } }) => {
      const index = this.exams.findIndex((e) => e.id === where.id);
      const [removed] = this.exams.splice(index, 1);
      return Promise.resolve(removed);
    },
  };

  /** Stages, hydrated with the exam and the counts `ExamStagesService` reads through `_count`. */
  readonly examStage = {
    findUnique: ({ where }: { where: { id?: string; stageKey?: string } }) => {
      const row = this.examStages.find((stage) =>
        where.id === undefined ? stage.stageKey === where.stageKey : stage.id === where.id,
      );
      return Promise.resolve(row ? this.hydrateStage(row) : null);
    },

    findMany: ({
      where = {},
      skip = 0,
      take,
    }: { where?: StageWhere; skip?: number; take?: number } = {}) => {
      const matched = this.examStages.filter((stage) => matchesStage(stage, where, this.exams));
      return Promise.resolve(
        matched
          .slice(skip, take === undefined ? undefined : skip + take)
          .map((stage) => this.hydrateStage(stage)),
      );
    },

    count: ({ where = {} }: { where?: StageWhere } = {}) =>
      Promise.resolve(this.examStages.filter((s) => matchesStage(s, where, this.exams)).length),

    create: ({ data }: { data: Partial<FakeExamStage> & { examId: string; stageKey: string } }) => {
      const created = makeExamStage({ ...data, id: `stage_new_${this.nextId++}` });
      this.examStages.push(created);
      return Promise.resolve(this.hydrateStage(created));
    },

    update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const stage = this.examStages.find((s) => s.id === where.id);
      if (!stage) throw new Error(`no stage ${where.id}`);
      Object.assign(stage, data);
      return Promise.resolve(this.hydrateStage(stage));
    },

    delete: ({ where }: { where: { id: string } }) => {
      const index = this.examStages.findIndex((s) => s.id === where.id);
      const [removed] = this.examStages.splice(index, 1);
      return Promise.resolve(removed);
    },
  };

  /** A copy, with the exam and counts the service's `include` asks for. */
  private hydrateStage(row: FakeExamStage) {
    const exam = this.exams.find((candidate) => candidate.id === row.examId);
    return {
      ...row,
      exam: exam
        ? { id: exam.id, code: exam.code, name: exam.name, family: exam.family }
        : { id: row.examId, code: '', name: '', family: EXAM_FAMILY.SSC },
    };
  }

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

    /** Both keys matter: `actorId` is how a non-super-admin is scoped to their own runs. */
    findFirst: ({ where = {} }: { where?: { id?: string; actorId?: string } } = {}) =>
      Promise.resolve(
        this.importLogs.find(
          (row) =>
            (where.id === undefined || row.id === where.id) &&
            (where.actorId === undefined || row.actorId === where.actorId),
        ) ?? null,
      ),

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

export interface FakeBaseConfigRow {
  id: string;
  examStageId: string;
  name: string;
  isDefault: boolean;
  clonedFromId: string | null;
  version: number;
  isActive: boolean;
  locked: boolean;
  totalQuestions: number;
  totalMarks: number;
  durationSec: number;
  timerTemplate: TimerTemplate;
  navigation: NavigationPolicy;
  optionalSectionCount: number | null;
  defaultTestUi: TestUi;
  languageMode: LanguageMode;
  languages: LanguageCode[];
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  calculatorEnabled: boolean;
  scoringVersion: number;
  createdById: string | null;
  createdAt: Date;
  _count: { tests: number };
}

export interface FakeSectionRow {
  id: string;
  baseConfigId: string;
  moduleId: string | null;
  name: string;
  order: number;
  subjectId: string | null;
  questionCount: number;
  marksPerQuestion: number;
  negativeMarks: number;
  durationSec: number | null;
  perQuestionSec: number | null;
  mandatory: boolean;
  meritOrQualifying: MeritType;
  qualifyingCutoff: number | null;
}

export interface FakeModuleRow {
  id: string;
  baseConfigId: string;
  name: string;
  order: number;
  durationSec: number | null;
}

export function makeBaseConfig(overrides: Partial<FakeBaseConfigRow> = {}): FakeBaseConfigRow {
  return {
    id: 'cfg_1',
    examStageId: 'stage_1',
    name: 'SSC CGL Tier 1 — official pattern',
    isDefault: true,
    clonedFromId: null,
    version: 1,
    isActive: true,
    locked: false,
    totalQuestions: 100,
    totalMarks: 200,
    durationSec: 3600,
    timerTemplate: TIMER_TEMPLATE.COMPOSITE_FREE,
    navigation: NAVIGATION_POLICY.FREE,
    optionalSectionCount: null,
    defaultTestUi: TEST_UI.CBT,
    languageMode: LANGUAGE_MODE.SINGLE,
    languages: [LANGUAGE_CODE.EN],
    shuffleQuestions: true,
    shuffleOptions: true,
    calculatorEnabled: false,
    scoringVersion: 1,
    createdById: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
    _count: { tests: overrides._count?.tests ?? 0 },
  };
}

export function makeSection(overrides: Partial<FakeSectionRow> = {}): FakeSectionRow {
  return {
    id: 'sec_1',
    baseConfigId: 'cfg_1',
    moduleId: null,
    name: 'General Intelligence',
    order: 1,
    subjectId: null,
    questionCount: 25,
    marksPerQuestion: 2,
    negativeMarks: 0.5,
    durationSec: null,
    perQuestionSec: null,
    mandatory: true,
    meritOrQualifying: MERIT_TYPE.MERIT,
    qualifyingCutoff: null,
    ...overrides,
  };
}

/**
 * Enough Prisma for `BaseConfigsService`. The lock is the database's own trigger in production;
 * here the service refuses first, which is exactly what these tests are about.
 */
export class FakeConfigPrisma {
  private seq = 0;

  constructor(
    readonly configs: FakeBaseConfigRow[] = [],
    readonly sections: FakeSectionRow[] = [],
    readonly modules: FakeModuleRow[] = [],
    readonly stages: FakeExamStage[] = [makeExamStage()],
    readonly exams: FakeExam[] = [makeExam()],
  ) {}

  /** `_new_`, so a written row can never collide with a seeded `cfg_1` and read as it. */
  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_new_${this.seq}`;
  }

  asService(): PrismaService {
    return this as unknown as PrismaService;
  }

  /** Both forms: the list reads through an array, every write through a callback. */
  $transaction<T>(work: Promise<T>[] | ((tx: FakeConfigPrisma) => Promise<T>)): Promise<T[] | T> {
    return typeof work === 'function' ? work(this) : Promise.all(work);
  }

  readonly examStage = {
    findUnique: ({ where }: { where: { id: string } }) => {
      const stage = this.stages.find((candidate) => candidate.id === where.id);
      return Promise.resolve(stage ? { ...stage } : null);
    },
  };

  readonly baseConfig = {
    findUnique: ({ where }: { where: { id: string } }) => {
      const row = this.configs.find((config) => config.id === where.id);
      return Promise.resolve(row ? this.hydrate(row) : null);
    },

    findMany: ({
      where = {},
      skip = 0,
      take,
    }: {
      where?: { examStageId?: string; isDefault?: boolean };
      skip?: number;
      take?: number;
    } = {}) => {
      const matched = this.configs.filter(
        (config) =>
          (where.examStageId === undefined || config.examStageId === where.examStageId) &&
          (where.isDefault === undefined || config.isDefault === where.isDefault),
      );
      return Promise.resolve(
        matched
          .slice(skip, take === undefined ? undefined : skip + take)
          .map((config) => this.hydrate(config)),
      );
    },

    count: () => Promise.resolve(this.configs.length),

    create: ({ data }: { data: Partial<FakeBaseConfigRow> & { examStageId: string } }) => {
      const created = makeBaseConfig({
        ...data,
        id: this.id('cfg'),
        isDefault: data.isDefault ?? false,
      });
      this.configs.push(created);
      return Promise.resolve(this.hydrate(created));
    },

    update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const config = this.configs.find((candidate) => candidate.id === where.id);
      if (!config) throw new Error(`no config ${where.id}`);
      Object.assign(config, data);
      return Promise.resolve(this.hydrate(config));
    },

    updateMany: ({
      where,
      data,
    }: {
      where: { examStageId: string; isDefault: boolean; id?: { not: string } };
      data: { isDefault: boolean };
    }) => {
      const matched = this.configs.filter(
        (config) =>
          config.examStageId === where.examStageId &&
          config.isDefault === where.isDefault &&
          (where.id?.not === undefined || config.id !== where.id.not),
      );
      for (const config of matched) config.isDefault = data.isDefault;
      return Promise.resolve({ count: matched.length });
    },

    delete: ({ where }: { where: { id: string } }) => {
      const index = this.configs.findIndex((config) => config.id === where.id);
      const [removed] = this.configs.splice(index, 1);
      return Promise.resolve(removed);
    },
  };

  readonly baseConfigSection = {
    create: ({ data }: { data: Partial<FakeSectionRow> & { baseConfigId: string } }) => {
      const created = makeSection({ ...data, id: this.id('sec') });
      this.sections.push(created);
      return Promise.resolve(created);
    },

    deleteMany: ({ where }: { where: { baseConfigId: string } }) => {
      const kept = this.sections.filter((row) => row.baseConfigId !== where.baseConfigId);
      const removed = this.sections.length - kept.length;
      this.sections.length = 0;
      this.sections.push(...kept);
      return Promise.resolve({ count: removed });
    },
  };

  readonly baseConfigModule = {
    create: ({
      data,
    }: {
      data: Partial<FakeModuleRow> & { baseConfigId: string; name: string };
    }) => {
      const created: FakeModuleRow = {
        id: this.id('mod'),
        baseConfigId: data.baseConfigId,
        name: data.name,
        order: data.order ?? 0,
        durationSec: data.durationSec ?? null,
      };
      this.modules.push(created);
      return Promise.resolve(created);
    },

    deleteMany: ({ where }: { where: { baseConfigId: string } }) => {
      const kept = this.modules.filter((row) => row.baseConfigId !== where.baseConfigId);
      const removed = this.modules.length - kept.length;
      this.modules.length = 0;
      this.modules.push(...kept);
      return Promise.resolve({ count: removed });
    },
  };

  /** A copy, with the stage and children the service's `include` asks for. */
  private hydrate(row: FakeBaseConfigRow) {
    const stage = this.stages.find((candidate) => candidate.id === row.examStageId);
    const exam = this.exams.find((candidate) => candidate.id === stage?.examId);
    return {
      ...row,
      examStage: {
        id: stage?.id ?? row.examStageId,
        stageKey: stage?.stageKey ?? '',
        name: stage?.name ?? '',
        exam: exam
          ? { id: exam.id, code: exam.code, name: exam.name, family: exam.family }
          : { id: '', code: '', name: '', family: EXAM_FAMILY.SSC },
      },
      sections: this.sections
        .filter((section) => section.baseConfigId === row.id)
        .sort((a, b) => a.order - b.order),
      modules: this.modules
        .filter((module) => module.baseConfigId === row.id)
        .sort((a, b) => a.order - b.order),
    };
  }
}

export interface FakeBranch {
  id: string;
  name: string;
  type: BranchType;
  isActive: boolean;
  createdAt: Date;
  _count: { students: number };
}

/** Auth as students and imports use it: one call, to hash a starting PIN. */
export function fakeAuth(): AuthService {
  return {
    hashPin: (pin: string) => Promise.resolve(`hash:${pin}`),
  } as unknown as AuthService;
}

/** A roster CSV with the demanded columns filled, so a test varies only what it is about. */
export function roster(csv: string): string {
  const REQUIRED_HEADERS = 'Student Type,Branch Name,Enrolled Families,Enrolled Exams,Programs';
  const REQUIRED_CELLS = 'ONLINE,ONLINE,SSC,,';
  const [header, ...rows] = csv.split('\n');
  return [`${header},${REQUIRED_HEADERS}`, ...rows.map((row) => `${row},${REQUIRED_CELLS}`)].join(
    '\n',
  );
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
    _count: { students: overrides._count?.students ?? 0 },
  };
}

export interface FakeExam {
  id: string;
  family: ExamFamily;
  name: string;
  code: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  _count: { stages: number };
}

export function makeExam(overrides: Partial<FakeExam> = {}): FakeExam {
  return {
    id: 'exam_1',
    family: EXAM_FAMILY.SSC,
    name: 'SSC CGL',
    code: 'SSC CGL',
    description: null,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
    // After the spread, so a caller passing only some fields still gets a count.
    _count: { stages: overrides._count?.stages ?? 0 },
  };
}

export interface FakeExamStage {
  id: string;
  examId: string;
  stageKey: string;
  name: string;
  order: number;
  mode: ExamMode;
  disposition: StageDisposition;
  isActive: boolean;
  createdAt: Date;
  _count: { baseConfigs: number; tests: number; series: number };
}

export function makeExamStage(overrides: Partial<FakeExamStage> = {}): FakeExamStage {
  return {
    id: 'stage_1',
    examId: 'exam_1',
    stageKey: 'SSC_CGL_T1',
    name: 'Tier 1',
    order: 1,
    mode: EXAM_MODE.CBT,
    disposition: STAGE_DISPOSITION.CONDUCTED,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
    // After the spread, so a caller passing only some fields still gets every count.
    _count: {
      baseConfigs: overrides._count?.baseConfigs ?? 0,
      tests: overrides._count?.tests ?? 0,
      series: overrides._count?.series ?? 0,
    },
  };
}

interface StageWhere {
  name?: { contains: string; mode?: 'insensitive' };
  examId?: KeyFilter;
  exam?: { family: ExamFamily };
  disposition?: StageDisposition;
  isActive?: boolean;
}

function matchesStage(stage: FakeExamStage, where: StageWhere, exams: FakeExam[]): boolean {
  const exam = exams.find((candidate) => candidate.id === stage.examId);
  return (
    (where.name ? stage.name.toLowerCase().includes(where.name.contains.toLowerCase()) : true) &&
    matchesKey(stage.examId, where.examId) &&
    (where.exam === undefined || exam?.family === where.exam.family) &&
    (where.disposition === undefined || stage.disposition === where.disposition) &&
    (where.isActive === undefined || stage.isActive === where.isActive)
  );
}

interface ExamWhere {
  name?: { contains: string; mode?: 'insensitive' };
  code?: { in: string[] };
  family?: KeyFilter;
  isActive?: boolean;
}

function matchesExam(exam: FakeExam, where: ExamWhere): boolean {
  return (
    (where.name ? exam.name.toLowerCase().includes(where.name.contains.toLowerCase()) : true) &&
    (where.code ? where.code.in.includes(exam.code) : true) &&
    matchesKey(exam.family, where.family) &&
    (where.isActive === undefined || exam.isActive === where.isActive)
  );
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

interface FakeGrantRow {
  adminId: string;
  featureKey: FeatureKey;
  level: PermissionLevel;
}

interface FakeAdminRow {
  id: string;
  email: string;
  fullName: string | null;
  isSuperAdmin: boolean;
  isActive: boolean;
  allBranches: boolean;
  createdById: string | null;
  createdAt: Date;
  branches: { branchId: string }[];
}

/** The nested write the service uses to replace an admin's branch set wholesale. */
interface BranchWrite {
  deleteMany?: Record<string, never>;
  create?: { branchId: string }[];
}

/** Enough Prisma for AdminsService to run unchanged, with no database. */
export class FakeAdminsPrisma {
  private seq = 0;
  readonly grants: FakeGrantRow[] = [];

  constructor(
    readonly admins: FakeAdminRow[] = [],
    readonly branches: FakeBranch[] = [],
  ) {}

  readonly branch = {
    count: ({ where }: { where: { id: { in: string[] } } }) =>
      Promise.resolve(this.branches.filter((row) => where.id.in.includes(row.id)).length),
  };

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

    create: ({
      data,
    }: {
      data: Partial<FakeAdminRow> & { email: string; branches?: BranchWrite };
    }) => {
      const row: FakeAdminRow = {
        id: this.id('adm'),
        email: data.email,
        fullName: data.fullName ?? null,
        isSuperAdmin: data.isSuperAdmin ?? false,
        isActive: true,
        allBranches: data.allBranches ?? false,
        createdById: data.createdById ?? null,
        createdAt: new Date(),
        branches: data.branches?.create ?? [],
      };
      this.admins.push(row);
      return Promise.resolve(row);
    },

    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<FakeAdminRow> & { branches?: BranchWrite };
    }) => {
      const row = this.admins.find((a) => a.id === where.id);
      if (!row) throw new Error(`no admin ${where.id}`);
      const { branches, ...scalars } = data;
      Object.assign(row, scalars);
      // `deleteMany` then `create` is a replacement, which is what the service means by it.
      if (branches) row.branches = branches.create ?? [];
      return Promise.resolve(row);
    },
  };

  /** One row per (admin, key, level) — the row IS its own key, so there is nothing to update. */
  readonly adminFeaturePermission = {
    findMany: ({
      where = {},
    }: { where?: { adminId?: string | { in: string[] }; featureKey?: FeatureKey } } = {}) =>
      Promise.resolve(
        this.grants
          .filter(
            (g) =>
              matchesKey(g.adminId, where.adminId) &&
              (where.featureKey === undefined || g.featureKey === where.featureKey),
          )
          .map((g) => ({ ...g })),
      ),

    findUnique: ({ where }: { where: { adminId_featureKey_level: FakeGrantRow } }) => {
      const key = where.adminId_featureKey_level;
      const row = this.grants.find((g) => sameGrant(g, key));
      return Promise.resolve(row ? { ...row } : null);
    },

    create: ({ data }: { data: FakeGrantRow }) => {
      const row = { ...data };
      this.grants.push(row);
      return Promise.resolve(row);
    },

    delete: ({ where }: { where: { adminId_featureKey_level: FakeGrantRow } }) => {
      const key = where.adminId_featureKey_level;
      const index = this.grants.findIndex((g) => sameGrant(g, key));
      const [removed] = this.grants.splice(index, 1);
      return Promise.resolve(removed);
    },

    deleteMany: ({ where }: { where: { adminId: string } }) => {
      const before = this.grants.length;
      for (let i = this.grants.length - 1; i >= 0; i -= 1) {
        if (this.grants[i]?.adminId === where.adminId) this.grants.splice(i, 1);
      }
      return Promise.resolve({ count: before - this.grants.length });
    },
  };
}

function sameGrant(row: FakeGrantRow, key: FakeGrantRow): boolean {
  return (
    row.adminId === key.adminId && row.featureKey === key.featureKey && row.level === key.level
  );
}

export function makeAdminRow(overrides: Partial<FakeAdminRow> = {}): FakeAdminRow {
  return {
    id: 'adm_1',
    email: 'admin@iace.co.in',
    fullName: 'An Admin',
    isSuperAdmin: false,
    isActive: true,
    allBranches: false,
    createdById: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    branches: [],
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

/** Immutable: an edit inserts one of these and repoints `Question.currentVersionId`. */
export interface FakeQuestionVersionRow {
  id: string;
  questionId: string;
  version: number;
  content: unknown;
  options: unknown;
  answerKey: unknown;
  createdById: string | null;
  createdAt: Date;
}

export interface FakeQuestionRow {
  id: string;
  questionCode: string | null;
  type: string;
  subjectId: string;
  topicId: string | null;
  difficulty: string;
  status: string;
  currentVersionId: string | null;
  tags: string[];
  stemHash: string | null;
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

export function makeQuestion(overrides: Partial<FakeQuestionRow> = {}): FakeQuestionRow {
  return {
    id: 'qst_1',
    questionCode: null,
    type: 'SINGLE_MCQ',
    subjectId: 'sub_1',
    topicId: 'top_1',
    difficulty: 'MEDIUM',
    status: 'ACTIVE',
    currentVersionId: null,
    tags: [],
    stemHash: 'hash_1',
    createdById: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

/** Version 1 of a question, which is what a seeded row normally has. */
export function makeQuestionVersion(
  overrides: Partial<FakeQuestionVersionRow> = {},
): FakeQuestionVersionRow {
  return {
    id: 'qv_1',
    questionId: 'qst_1',
    version: 1,
    content: { en: { stem: [{ type: 'TEXT', text: 'What is 20% of 150?' }] } },
    options: [],
    answerKey: null,
    createdById: null,
    createdAt: FIXED_NOW,
    ...overrides,
  };
}

interface FakeQuestionWhere {
  AND?: FakeQuestionWhere[];
  OR?: FakeQuestionWhere[];
  id?: string | { in?: string[]; not?: string };
  subjectId?: KeyFilter;
  topicId?: KeyFilter;
  type?: KeyFilter;
  difficulty?: KeyFilter;
  status?: KeyFilter;
  stemHash?: string | { not?: null };
  tags?: { has?: string };
  currentVersion?: unknown;
}

/** A paper or an attempt holding one version of one question. */
export interface FakeVersionRef {
  questionId: string;
  questionVersionId: string;
}

/** Prisma's JSON sentinels are how you WRITE null; a read hands back null itself. */
const jsonNulled = <T extends object>(data: T): T =>
  Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      value === Prisma.JsonNull || value === Prisma.DbNull ? null : value,
    ]),
  ) as T;

const copyOf = (row: FakeQuestionVersionRow | undefined): FakeQuestionVersionRow | null =>
  row ? { ...row } : null;

const countRefs = (rows: FakeVersionRef[], where: Partial<FakeVersionRef>): number =>
  rows.filter(
    (row) =>
      row.questionId === where.questionId &&
      (where.questionVersionId === undefined || row.questionVersionId === where.questionVersionId),
  ).length;

export class FakeQuestionBankPrisma {
  private seq = 0;

  constructor(
    readonly questions: FakeQuestionRow[] = [],
    readonly subjects: FakeSubjectRow[] = [],
    readonly topics: FakeTopicRow[] = [],
    readonly versions: FakeQuestionVersionRow[] = [],
    readonly paperRefs: FakeVersionRef[] = [],
    readonly attemptRefs: FakeVersionRef[] = [],
    readonly statRefs: { questionId: string }[] = [],
  ) {}

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  asService(): PrismaService {
    return this as unknown as PrismaService;
  }

  /**
   * Both forms. The taxonomy services pass an array; anything that writes a version passes a
   * callback, because a question and its first version are two statements that share one write.
   */
  $transaction<T>(
    work: Promise<T>[] | ((tx: FakeQuestionBankPrisma) => Promise<T>),
  ): Promise<T[] | T> {
    return typeof work === 'function' ? work(this) : Promise.all(work);
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
        // The column default, which decides whether an edit revises or versions.
        status: (data.status as FakeQuestionRow['status']) ?? 'DRAFT',
      });
      this.questions.push(row);
      return Promise.resolve(this.hydrate(row));
    },

    update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.questions.find((question) => question.id === where.id);
      if (!row) throw new Error(`no question ${where.id}`);
      const { subject, topic, ...rest } = data;
      Object.assign(row, rest);
      if (subject) row.subjectId = subjectIdOf(data);
      if (topic !== undefined) row.topicId = relationIdOf(data, 'topic');
      return Promise.resolve(this.hydrate(row));
    },

    delete: ({ where }: { where: { id: string } }) => {
      const index = this.questions.findIndex((question) => question.id === where.id);
      if (index === -1) throw new Error(`no question ${where.id}`);
      const [row] = this.questions.splice(index, 1);
      return Promise.resolve(row!);
    },

    /** The same matcher `findMany` uses: a conditional write is a where, not just a list of ids. */
    updateMany: ({ where, data }: { where?: FakeQuestionWhere; data: Record<string, unknown> }) => {
      const rows = this.matching(where);
      for (const row of rows) Object.assign(row, data);
      return Promise.resolve({ count: rows.length });
    },
  };

  readonly questionVersion = {
    create: ({ data }: { data: Partial<FakeQuestionVersionRow> & { questionId: string } }) => {
      const row = makeQuestionVersion({ ...jsonNulled(data), id: this.id('qv') });
      this.versions.push(row);
      return Promise.resolve(row);
    },

    findMany: ({ where = {} }: { where?: { questionId?: string } } = {}) =>
      Promise.resolve(
        this.versions.filter(
          (row) => where.questionId === undefined || row.questionId === where.questionId,
        ),
      ),

    update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.versions.find((version) => version.id === where.id);
      if (!row) throw new Error(`no question version ${where.id}`);
      Object.assign(row, jsonNulled(data));
      return Promise.resolve(row);
    },

    deleteMany: ({ where }: { where: { questionId: string } }) => {
      const doomed = this.versions.filter((row) => row.questionId === where.questionId);
      for (const row of doomed) this.versions.splice(this.versions.indexOf(row), 1);
      return Promise.resolve({ count: doomed.length });
    },
  };

  /** What pins a version: the service refuses to rewrite one a paper or an attempt is holding. */
  readonly paperQuestion = {
    count: ({ where }: { where: Partial<FakeVersionRef> }) =>
      Promise.resolve(countRefs(this.paperRefs, where)),
  };

  readonly attemptQuestion = {
    count: ({ where }: { where: Partial<FakeVersionRef> }) =>
      Promise.resolve(countRefs(this.attemptRefs, where)),
  };

  /** Keyed on the question alone, so it outlives a version and blocks a delete of its own. */
  readonly testQuestionStat = {
    count: ({ where }: { where: { questionId: string } }) =>
      Promise.resolve(this.statRefs.filter((row) => row.questionId === where.questionId).length),
  };

  readonly subject = {
    findMany: ({ where }: { where?: { id?: { in: string[] } } } = {}) =>
      Promise.resolve(
        this.subjects
          .filter((row) => !where?.id?.in || where.id.in.includes(row.id))
          .map((row) => ({
            ...row,
            topics: this.topics.filter((topic) => topic.subjectId === row.id),
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
        _count: { questions: this.questions.filter((q) => q.topicId === row.id).length },
      });
    },
  };

  private hydrate(row: FakeQuestionRow) {
    const subject = this.subjects.find((candidate) => candidate.id === row.subjectId);
    const topic = this.topics.find((candidate) => candidate.id === row.topicId);

    return {
      ...row,
      subject: subject ? { id: subject.id, name: subject.name } : { id: row.subjectId, name: '' },
      topic: topic ? { id: topic.id, name: topic.name } : null,
      // A copy: an in-place revision must not reach back and rewrite a row already read.
      currentVersion: copyOf(this.versions.find((v) => v.id === row.currentVersionId)),
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
  // Every one of these is a set on the wire, so `in` is the shape the service builds.
  (row, where) => matchesKey(row.subjectId, where.subjectId),
  (row, where) => row.topicId === null || matchesKey(row.topicId, where.topicId),
  (row, where) => matchesKey(row.type, where.type),
  (row, where) => matchesKey(row.difficulty, where.difficulty),
  (row, where) => matchesKey(row.status, where.status),
  (row, where) => !where.tags?.has || row.tags.includes(where.tags.has),
];

const QUESTION_WHERE_KEYS = [
  'AND',
  'OR',
  'id',
  'subjectId',
  'topicId',
  'type',
  'difficulty',
  'status',
  'stemHash',
  'tags',
  'currentVersion',
] as const;

function matches(row: FakeQuestionRow, where: FakeQuestionWhere | undefined): boolean {
  if (!where) return true;
  return matchesTree(where, (clause) => {
    onlyUnderstands(clause, QUESTION_WHERE_KEYS, 'The question fake');
    return (
      idMatches(row, clause.id) &&
      stemHashMatches(row, clause.stemHash) &&
      QUESTION_FIELD_CHECKS.every((check) => check(row, clause))
    );
  });
}

function subjectIdOf(data: Record<string, unknown>): string {
  const connect = (data.subject as { connect?: { id: string } } | undefined)?.connect;
  return connect?.id ?? (data.subjectId as string) ?? 'sub_1';
}

function relationIdOf(data: Record<string, unknown>, key: 'topic'): string | null {
  const connect = (data[key] as { connect?: { id: string } } | undefined)?.connect;
  if (connect?.id) return connect.id;
  const direct = data[`${key}Id`];
  return typeof direct === 'string' ? direct : null;
}

export interface FakeProgramRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
}

export interface FakeSeriesRow {
  id: string;
  name: string;
  description: string | null;
  examStageId: string | null;
  programCode: string | null;
  sequentialTests: boolean;
  prerequisiteSeriesId: string | null;
  unlockMode: UnlockMode;
  isFree: boolean;
  createdAt: Date;
  _count: { tests: number };
}

export interface FakeBranchConfigRow {
  id: string;
  branchId: string;
  testSeriesId: string;
  enabled: boolean;
  startAt: Date | null;
  endAt: Date | null;
  createdAt: Date;
}

export interface FakeGrantRowAccess {
  studentId: string;
  testSeriesId: string;
  createdById: string | null;
  createdAt: Date;
}

export function makeProgram(overrides: Partial<FakeProgramRow> = {}): FakeProgramRow {
  return {
    id: 'prog_1',
    code: 'SSC CGL FOUNDATION',
    name: 'SSC CGL Foundation',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

export function makeSeries(overrides: Partial<FakeSeriesRow> = {}): FakeSeriesRow {
  return {
    id: 'srs_1',
    name: 'SSC CGL Tier 1 mocks',
    description: null,
    examStageId: 'stage_1',
    programCode: null,
    sequentialTests: false,
    prerequisiteSeriesId: null,
    unlockMode: UNLOCK_MODE.AUTO,
    isFree: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
    _count: { tests: overrides._count?.tests ?? 0 },
  };
}

/** Enough Prisma for the access services: the catalog, the series and the per-branch fan-out. */
export class FakeAccessPrisma {
  private seq = 0;

  constructor(
    readonly programs: FakeProgramRow[] = [],
    readonly series: FakeSeriesRow[] = [],
    readonly branches: FakeBranch[] = [],
    readonly branchConfigs: FakeBranchConfigRow[] = [],
    readonly students: FakeStudent[] = [],
    readonly grants: FakeGrantRowAccess[] = [],
    readonly examStages: FakeExamStage[] = [makeExamStage()],
  ) {}

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_new_${this.seq}`;
  }

  asService(): PrismaService {
    return this as unknown as PrismaService;
  }

  $transaction<T>(work: Promise<T>[] | ((tx: FakeAccessPrisma) => Promise<T>)): Promise<T[] | T> {
    return typeof work === 'function' ? work(this) : Promise.all(work);
  }

  readonly examStage = {
    findUnique: ({ where }: { where: { id: string } }) => {
      const stage = this.examStages.find((candidate) => candidate.id === where.id);
      return Promise.resolve(stage ? { ...stage } : null);
    },
  };

  readonly branch = {
    // Every LIVE branch: the fan-out asks for `deletedAt: null`, and a fake with no soft-deleted
    // rows answers the same question either way.
    findMany: () =>
      Promise.resolve(this.branches.map((branch) => ({ id: branch.id, name: branch.name }))),
  };

  readonly program = {
    findUnique: ({ where }: { where: { id?: string; code?: string } }) => {
      const row = this.programs.find((program) =>
        where.id === undefined ? program.code === where.code : program.id === where.id,
      );
      return Promise.resolve(row ? { ...row } : null);
    },

    findMany: ({ where = {} }: { where?: { code?: { in: string[] } } } = {}) =>
      Promise.resolve(
        this.programs.filter((program) => !where.code?.in || where.code.in.includes(program.code)),
      ),

    count: () => Promise.resolve(this.programs.length),

    create: ({ data }: { data: { code: string; name: string } }) => {
      const created = makeProgram({ ...data, id: this.id('prog') });
      this.programs.push(created);
      return Promise.resolve(created);
    },

    update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const program = this.programs.find((row) => row.id === where.id);
      if (!program) throw new Error(`no program ${where.id}`);
      Object.assign(program, data);
      return Promise.resolve(program);
    },

    delete: ({ where }: { where: { id: string } }) => {
      const index = this.programs.findIndex((row) => row.id === where.id);
      const [removed] = this.programs.splice(index, 1);
      return Promise.resolve(removed);
    },
  };

  readonly testSeries = {
    findUnique: ({ where }: { where: { id: string } }) => {
      const row = this.series.find((candidate) => candidate.id === where.id);
      return Promise.resolve(row ? this.hydrate(row) : null);
    },

    findMany: ({ skip = 0, take }: { skip?: number; take?: number } = {}) =>
      Promise.resolve(
        this.series
          .slice(skip, take === undefined ? undefined : skip + take)
          .map((row) => this.hydrate(row)),
      ),

    count: ({
      where = {},
    }: { where?: { programCode?: string; prerequisiteSeriesId?: string } } = {}) =>
      Promise.resolve(
        this.series.filter(
          (row) =>
            (where.programCode === undefined || row.programCode === where.programCode) &&
            (where.prerequisiteSeriesId === undefined ||
              row.prerequisiteSeriesId === where.prerequisiteSeriesId),
        ).length,
      ),

    create: ({ data }: { data: Partial<FakeSeriesRow> & { name: string } }) => {
      const created = makeSeries({ ...data, id: this.id('srs') });
      this.series.push(created);
      return Promise.resolve(this.hydrate(created));
    },

    update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.series.find((candidate) => candidate.id === where.id);
      if (!row) throw new Error(`no series ${where.id}`);
      Object.assign(row, data);
      return Promise.resolve(this.hydrate(row));
    },

    delete: ({ where }: { where: { id: string } }) => {
      const index = this.series.findIndex((row) => row.id === where.id);
      const [removed] = this.series.splice(index, 1);
      return Promise.resolve(removed);
    },
  };

  readonly branchTestConfig = {
    findUnique: ({
      where,
    }: {
      where: { branchId_testSeriesId: { branchId: string; testSeriesId: string } };
    }) => {
      const key = where.branchId_testSeriesId;
      const row = this.branchConfigs.find(
        (config) => config.branchId === key.branchId && config.testSeriesId === key.testSeriesId,
      );
      return Promise.resolve(row ? { ...row } : null);
    },

    findMany: ({ where = {} }: { where?: { testSeriesId?: string | { in: string[] } } } = {}) =>
      Promise.resolve(
        this.branchConfigs
          .filter((config) => matchesKey(config.testSeriesId, where.testSeriesId))
          .map((config) => ({
            ...config,
            branch: this.branchRef(config.branchId),
          })),
      ),

    createMany: ({
      data,
    }: {
      data: { branchId: string; testSeriesId: string; enabled: boolean }[];
    }) => {
      for (const row of data) {
        this.branchConfigs.push({
          id: this.id('btc'),
          startAt: null,
          endAt: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          ...row,
        });
      }
      return Promise.resolve({ count: data.length });
    },

    update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.branchConfigs.find((config) => config.id === where.id);
      if (!row) throw new Error(`no branch config ${where.id}`);
      Object.assign(row, data);
      return Promise.resolve({ ...row, branch: this.branchRef(row.branchId) });
    },
  };

  readonly student = {
    findUnique: ({ where }: { where: { id: string } }) => {
      const row = this.students.find((student) => student.id === where.id);
      return Promise.resolve(row ? { ...row } : null);
    },

    count: ({ where = {} }: { where?: { programs?: { has: string } } } = {}) =>
      Promise.resolve(
        this.students.filter(
          (student) => !where.programs || student.programs.includes(where.programs.has),
        ).length,
      ),
  };

  readonly studentGrant = {
    findUnique: ({
      where,
    }: {
      where: { studentId_testSeriesId: { studentId: string; testSeriesId: string } };
    }) => {
      const key = where.studentId_testSeriesId;
      const row = this.grants.find(
        (grant) => grant.studentId === key.studentId && grant.testSeriesId === key.testSeriesId,
      );
      return Promise.resolve(row ? { testSeriesId: row.testSeriesId } : null);
    },

    findMany: ({ where }: { where: { studentId: string } }) =>
      Promise.resolve(
        this.grants
          .filter((grant) => grant.studentId === where.studentId)
          .map((grant) => ({
            ...grant,
            testSeries: this.seriesRef(grant.testSeriesId),
          })),
      ),

    upsert: ({
      where,
      create,
    }: {
      where: { studentId_testSeriesId: { studentId: string; testSeriesId: string } };
      create: FakeGrantRowAccess;
    }) => {
      const key = where.studentId_testSeriesId;
      const held = this.grants.find(
        (grant) => grant.studentId === key.studentId && grant.testSeriesId === key.testSeriesId,
      );
      if (held) return Promise.resolve(held);

      const row = { ...create, createdAt: new Date('2026-01-01T00:00:00.000Z') };
      this.grants.push(row);
      return Promise.resolve(row);
    },

    deleteMany: ({ where }: { where: { studentId: string; testSeriesId: string } }) => {
      const kept = this.grants.filter(
        (grant) => grant.studentId !== where.studentId || grant.testSeriesId !== where.testSeriesId,
      );
      const removed = this.grants.length - kept.length;
      this.grants.length = 0;
      this.grants.push(...kept);
      return Promise.resolve({ count: removed });
    },
  };

  private branchRef(branchId: string): { id: string; name: string } {
    const branch = this.branches.find((candidate) => candidate.id === branchId);
    return { id: branchId, name: branch?.name ?? '' };
  }

  private seriesRef(testSeriesId: string): { id: string; name: string } {
    const series = this.series.find((candidate) => candidate.id === testSeriesId);
    return { id: testSeriesId, name: series?.name ?? '' };
  }

  private hydrate(row: FakeSeriesRow) {
    const stage = this.examStages.find((candidate) => candidate.id === row.examStageId);
    return {
      ...row,
      examStage: stage ? { id: stage.id, name: stage.name, exam: { code: 'SSC CGL' } } : null,
    };
  }
}

export function makeBranchConfig(
  overrides: Partial<FakeBranchConfigRow> = {},
): FakeBranchConfigRow {
  return {
    id: 'btc_1',
    branchId: 'br_1',
    testSeriesId: 'srs_1',
    enabled: true,
    startAt: null,
    endAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

/** The `Test` columns the catalog reads. The tests module owns the real table. */
export interface FakeTestRow {
  id: string;
  title: string | null;
  status: TestStatus;
}

export function makeTestRow(overrides: Partial<FakeTestRow> = {}): FakeTestRow {
  return { id: 'tst_1', title: 'Mock 1', status: TEST_STATUS.ACTIVE, ...overrides };
}

export interface FakeSeriesTestRow {
  testSeriesId: string;
  testId: string;
  order: number | null;
}

export interface FakeUnlockRow {
  studentId: string;
  testSeriesId: string;
  unlockedAt: Date | null;
}

export interface FakeUnlockRequestRow {
  id: string;
  studentId: string;
  testSeriesId: string;
  status: UnlockRequestStatus;
  requestedAt: Date;
  decidedAt: Date | null;
  decidedById: string | null;
}

export interface FakeCatalogData {
  students?: FakeStudent[];
  series?: FakeSeriesRow[];
  branchConfigs?: FakeBranchConfigRow[];
  grants?: FakeGrantRowAccess[];
  unlocks?: FakeUnlockRow[];
  unlockRequests?: FakeUnlockRequestRow[];
  seriesTests?: FakeSeriesTestRow[];
  tests?: FakeTestRow[];
  stages?: FakeExamStage[];
  exams?: FakeExam[];
}

/**
 * One reach clause, by the COLUMNS it constrains rather than by which of the three paths it is:
 * an omitted column constrains nothing, exactly as SQL reads it.
 */
interface CatalogReachWhere {
  grants?: { some: { studentId: string } };
  programCode?: null | { in: string[] };
  examStage?: { exam: { code: { in: string[] } } };
}

interface CatalogSeriesWhere {
  branchConfigs?: { some: { branchId: string; enabled: boolean } };
  OR?: CatalogReachWhere[];
  id?: { in: string[] };
}

interface CatalogInclude {
  branchConfigs: { where: { branchId: string } };
  tests: { where: { test: { status: TestStatus } } };
}

type CatalogSortField = 'name' | 'id';
type CatalogOrderBy = Partial<Record<CatalogSortField, 'asc' | 'desc'>>;

/**
 * Enough Prisma for the access resolver, and no more. It evaluates the `where` it is HANDED
 * rather than knowing anything about reach, so a truth-table test really exercises the
 * predicates the resolver builds.
 */
export class FakeCatalogPrisma {
  /** Every read that reached "Postgres" — what the cache tests count. */
  readonly queries: string[] = [];

  /** Runs as each read reaches "Postgres", so a test can interleave a bust with a resolve. */
  onQuery: ((name: string) => Promise<void>) | null = null;

  private readonly data: Required<FakeCatalogData>;

  constructor(data: FakeCatalogData = {}) {
    this.data = {
      students: data.students ?? [],
      series: data.series ?? [],
      branchConfigs: data.branchConfigs ?? [],
      grants: data.grants ?? [],
      unlockRequests: data.unlockRequests ?? [],
      unlocks: data.unlocks ?? [],
      seriesTests: data.seriesTests ?? [],
      tests: data.tests ?? [],
      stages: data.stages ?? [makeExamStage()],
      exams: data.exams ?? [makeExam()],
    };
  }

  asService(): PrismaService {
    return this as unknown as PrismaService;
  }

  readonly student = {
    findFirst: async ({
      where,
    }: {
      where: { id: string; deletedAt?: null; isActive?: boolean };
    }) => {
      await this.record('student.findFirst');
      const row = this.data.students.find(
        (student) =>
          student.id === where.id &&
          (where.deletedAt === undefined || student.deletedAt === null) &&
          (where.isActive === undefined || student.isActive === where.isActive),
      );
      return row ? { ...row } : null;
    },

    findUnique: async ({ where }: { where: { id: string } }) => {
      await this.record('student.findUnique');
      const row = this.data.students.find((student) => student.id === where.id);
      return row ? { ...row } : null;
    },
  };

  readonly testSeries = {
    findMany: async ({
      where = {},
      include,
      orderBy = [],
    }: {
      where?: CatalogSeriesWhere;
      include?: CatalogInclude;
      orderBy?: CatalogOrderBy[];
    } = {}) => {
      await this.record('testSeries.findMany');
      const rows = this.data.series
        .filter((row) => this.matchesSeries(row, where))
        .sort(comparing(orderBy));
      return include ? rows.map((row) => this.hydrate(row, include)) : rows;
    },
  };

  readonly studentSeriesUnlock = {
    findMany: async ({
      where,
    }: {
      where: {
        studentId: string;
        testSeriesId: { in: string[] };
        unlockedAt?: { not: null };
      };
    }) => {
      await this.record('studentSeriesUnlock.findMany');
      const rows = this.data.unlocks.filter(
        (unlock) =>
          unlock.studentId === where.studentId &&
          where.testSeriesId.in.includes(unlock.testSeriesId) &&
          (where.unlockedAt === undefined || unlock.unlockedAt !== null),
      );
      return rows.map((unlock) => ({ testSeriesId: unlock.testSeriesId }));
    },

    findUnique: async ({
      where,
    }: {
      where: { studentId_testSeriesId: { studentId: string; testSeriesId: string } };
    }) => {
      await this.record('studentSeriesUnlock.findUnique');
      return this.heldUnlock(where.studentId_testSeriesId) ?? null;
    },

    /** `update: {}` is the point: a row that is already open keeps the time it was opened at. */
    upsert: async ({
      where,
      create,
    }: {
      where: { studentId_testSeriesId: { studentId: string; testSeriesId: string } };
      create: { studentId: string; testSeriesId: string; unlockedAt: Date };
    }) => {
      await this.record('studentSeriesUnlock.upsert');
      const held = this.heldUnlock(where.studentId_testSeriesId);
      if (held) return held;

      const row: FakeUnlockRow = { ...create };
      this.data.unlocks.push(row);
      return row;
    },

    /** The half the empty `update` cannot do: a row carrying no time is still a locked row. */
    updateMany: async ({
      where,
      data,
    }: {
      where: { studentId: string; testSeriesId: string; unlockedAt: null };
      data: { unlockedAt: Date };
    }) => {
      await this.record('studentSeriesUnlock.updateMany');
      const rows = this.data.unlocks.filter(
        (unlock) =>
          unlock.studentId === where.studentId &&
          unlock.testSeriesId === where.testSeriesId &&
          unlock.unlockedAt === null,
      );
      for (const row of rows) Object.assign(row, data);
      return { count: rows.length };
    },
  };

  readonly seriesUnlockRequest = {
    findFirst: async ({ where }: { where: UnlockRequestWhere }) => {
      await this.record('seriesUnlockRequest.findFirst');
      return this.data.unlockRequests.find((row) => matchesRequest(row, where)) ?? null;
    },

    findUnique: async ({ where }: { where: { id: string } }) => {
      await this.record('seriesUnlockRequest.findUnique');
      const row = this.data.unlockRequests.find((candidate) => candidate.id === where.id);
      return row ? this.hydrateRequest(row) : null;
    },

    findMany: async ({
      where = {},
      skip = 0,
      take,
    }: {
      where?: UnlockRequestWhere;
      skip?: number;
      take?: number;
    } = {}) => {
      await this.record('seriesUnlockRequest.findMany');
      return this.data.unlockRequests
        .filter((row) => matchesRequest(row, where))
        .sort((left, right) => right.requestedAt.getTime() - left.requestedAt.getTime())
        .slice(skip, take === undefined ? undefined : skip + take)
        .map((row) => this.hydrateRequest(row));
    },

    count: async ({ where = {} }: { where?: UnlockRequestWhere } = {}) => {
      await this.record('seriesUnlockRequest.count');
      return this.data.unlockRequests.filter((row) => matchesRequest(row, where)).length;
    },

    /** Enforces the partial unique the migration declares — Prisma cannot see it, so it throws. */
    create: async ({ data }: { data: { studentId: string; testSeriesId: string } }) => {
      await this.record('seriesUnlockRequest.create');
      const open = this.data.unlockRequests.some(
        (row) =>
          row.studentId === data.studentId &&
          row.testSeriesId === data.testSeriesId &&
          row.status === UNLOCK_REQUEST_STATUS.PENDING,
      );
      if (open) throw uniqueViolation('SeriesUnlockRequest_open_key');

      this.requestSeq += 1;
      const row: FakeUnlockRequestRow = {
        id: `sur_${this.requestSeq}`,
        studentId: data.studentId,
        testSeriesId: data.testSeriesId,
        status: UNLOCK_REQUEST_STATUS.PENDING,
        requestedAt: new Date('2026-06-01T00:00:00.000Z'),
        decidedAt: null,
        decidedById: null,
      };
      this.data.unlockRequests.push(row);
      return row;
    },

    updateMany: async ({
      where,
      data,
    }: {
      where: UnlockRequestWhere & { id?: string };
      data: Partial<FakeUnlockRequestRow>;
    }) => {
      await this.record('seriesUnlockRequest.updateMany');
      const rows = this.data.unlockRequests.filter(
        (row) => (where.id === undefined || row.id === where.id) && matchesRequest(row, where),
      );
      for (const row of rows) Object.assign(row, data);
      return { count: rows.length };
    },
  };

  $transaction<T>(work: Promise<T>[]): Promise<T[]> {
    return Promise.all(work);
  }

  private requestSeq = 0;

  private heldUnlock(key: { studentId: string; testSeriesId: string }): FakeUnlockRow | undefined {
    return this.data.unlocks.find(
      (unlock) => unlock.studentId === key.studentId && unlock.testSeriesId === key.testSeriesId,
    );
  }

  private hydrateRequest(row: FakeUnlockRequestRow) {
    const series = this.data.series.find((candidate) => candidate.id === row.testSeriesId);
    const student = this.data.students.find((candidate) => candidate.id === row.studentId);
    return {
      ...row,
      testSeries: { id: row.testSeriesId, name: series?.name ?? '' },
      student: {
        id: row.studentId,
        fullName: student?.fullName ?? null,
        mobile: student?.mobile ?? '',
      },
    };
  }

  private async record(name: string): Promise<void> {
    this.queries.push(name);
    await this.onQuery?.(name);
  }

  private matchesSeries(row: FakeSeriesRow, where: CatalogSeriesWhere): boolean {
    const gate = where.branchConfigs?.some;
    const enabledHere =
      gate === undefined ||
      this.data.branchConfigs.some(
        (config) =>
          config.testSeriesId === row.id &&
          config.branchId === gate.branchId &&
          config.enabled === gate.enabled,
      );

    return (
      enabledHere &&
      (where.id === undefined || where.id.in.includes(row.id)) &&
      (where.OR === undefined || where.OR.some((clause) => this.matchesReach(row, clause)))
    );
  }

  private matchesReach(row: FakeSeriesRow, clause: CatalogReachWhere): boolean {
    return (
      this.matchesGrant(row, clause.grants) &&
      matchesProgramCode(row.programCode, clause.programCode) &&
      this.matchesExam(row, clause.examStage)
    );
  }

  private matchesGrant(row: FakeSeriesRow, filter: CatalogReachWhere['grants']): boolean {
    if (filter === undefined) return true;
    return this.data.grants.some(
      (grant) => grant.testSeriesId === row.id && grant.studentId === filter.some.studentId,
    );
  }

  private matchesExam(row: FakeSeriesRow, filter: CatalogReachWhere['examStage']): boolean {
    if (filter === undefined) return true;
    const code = this.examCodeOf(row.examStageId);
    return code !== null && filter.exam.code.in.includes(code);
  }

  private examCodeOf(examStageId: string | null): string | null {
    const stage = this.data.stages.find((candidate) => candidate.id === examStageId);
    const exam = this.data.exams.find((candidate) => candidate.id === stage?.examId);
    return exam?.code ?? null;
  }

  private hydrate(row: FakeSeriesRow, include: CatalogInclude) {
    const stage = this.data.stages.find((candidate) => candidate.id === row.examStageId);
    const code = this.examCodeOf(row.examStageId);
    const prerequisite = this.data.series.find(
      (candidate) => candidate.id === row.prerequisiteSeriesId,
    );

    return {
      ...row,
      examStage: stage && code !== null ? { id: stage.id, name: stage.name, exam: { code } } : null,
      prerequisiteSeries: prerequisite ? { name: prerequisite.name } : null,
      branchConfigs: this.data.branchConfigs.filter(
        (config) =>
          config.testSeriesId === row.id &&
          config.branchId === include.branchConfigs.where.branchId,
      ),
      tests: this.data.seriesTests
        .filter((link) => link.testSeriesId === row.id)
        .flatMap((link) => {
          const test = this.data.tests.find((candidate) => candidate.id === link.testId);
          return test?.status === include.tests.where.test.status
            ? [{ order: link.order, test: { id: test.id, title: test.title } }]
            : [];
        }),
    };
  }
}

interface UnlockRequestWhere {
  studentId?: string;
  testSeriesId?: string;
  status?: UnlockRequestStatus;
}

function matchesRequest(row: FakeUnlockRequestRow, where: UnlockRequestWhere): boolean {
  return (
    (where.studentId === undefined || row.studentId === where.studentId) &&
    (where.testSeriesId === undefined || row.testSeriesId === where.testSeriesId) &&
    (where.status === undefined || row.status === where.status)
  );
}

/** The real error class, so a service that tests for P2002 is tested against what Prisma throws. */
function uniqueViolation(target: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });
}

/** `IS NULL` and `IN (…)` read off the ROW's value, so a clause that drops one is really felt. */
function matchesProgramCode(
  value: string | null,
  filter: CatalogReachWhere['programCode'],
): boolean {
  if (filter === undefined) return true;
  if (filter === null) return value === null;
  return value !== null && filter.in.includes(value);
}

function comparing(orderBy: CatalogOrderBy[]) {
  const terms = orderBy.flatMap(
    (term) => Object.entries(term) as [CatalogSortField, 'asc' | 'desc'][],
  );

  return (left: FakeSeriesRow, right: FakeSeriesRow): number => {
    for (const [field, direction] of terms) {
      const order = left[field].localeCompare(right[field]);
      if (order !== 0) return direction === 'desc' ? -order : order;
    }
    return 0;
  };
}

/**
 * Whatever validates a list of codes before a student may carry them — the exam catalog, the
 * program catalog. One shape, because the seam is `assertUsable(codes, fieldKey)` on both.
 */
export class FakeCodeCatalog {
  readonly calls: { codes: string[]; fieldKey: string }[] = [];

  constructor(private readonly usable: string[] = []) {}

  assertUsable(codes: string[], fieldKey: string): Promise<void> {
    this.calls.push({ codes, fieldKey });
    const unknown = codes.filter((code) => !this.usable.includes(code));
    if (unknown.length > 0) {
      const message = `No such code: ${unknown.join(', ')}`;
      throw new AppException(ErrorCodes.VALIDATION_ERROR, message, {
        fieldErrors: { [fieldKey]: [message] },
      });
    }
    return Promise.resolve();
  }

  asService<T>(): T {
    return this as unknown as T;
  }
}

/** The series seam a branch write goes through: a new centre appears on every series, off. */
export class FakeSeriesFanOut {
  readonly branchIds: string[] = [];

  fanOutToBranch(branchId: string): Promise<void> {
    this.branchIds.push(branchId);
    return Promise.resolve();
  }

  asService<T>(): T {
    return this as unknown as T;
  }
}

export interface FakeNotificationRow {
  id: string;
  studentId: string;
  type: NotificationType;
  title: string;
  body: string | null;
  testId: string | null;
  testSeriesId: string | null;
  isRead: boolean;
  createdAt: Date;
}

interface NotificationWhere {
  id?: string;
  studentId?: string;
  isRead?: boolean;
}

function matchesNotification(row: FakeNotificationRow, where: NotificationWhere): boolean {
  return (
    (where.id === undefined || row.id === where.id) &&
    (where.studentId === undefined || row.studentId === where.studentId) &&
    (where.isRead === undefined || row.isRead === where.isRead)
  );
}

/** Enough Prisma for the notifications module: one table, written once and read by its owner. */
export class FakeNotificationsPrisma {
  private seq = 0;

  constructor(readonly rows: FakeNotificationRow[] = []) {}

  asService(): PrismaService {
    return this as unknown as PrismaService;
  }

  $transaction<T>(work: Promise<T>[]): Promise<T[]> {
    return Promise.all(work);
  }

  readonly notification = {
    create: ({ data }: { data: Omit<FakeNotificationRow, 'id' | 'isRead' | 'createdAt'> }) => {
      this.seq += 1;
      const row: FakeNotificationRow = {
        ...data,
        id: `ntf_${this.seq}`,
        isRead: false,
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
      };
      this.rows.push(row);
      return Promise.resolve(row);
    },

    findFirst: ({ where }: { where: NotificationWhere }) =>
      Promise.resolve(this.rows.find((row) => matchesNotification(row, where)) ?? null),

    findMany: ({
      where = {},
      skip = 0,
      take,
    }: { where?: NotificationWhere; skip?: number; take?: number } = {}) =>
      Promise.resolve(
        this.rows
          .filter((row) => matchesNotification(row, where))
          .slice(skip, take === undefined ? undefined : skip + take),
      ),

    count: ({ where = {} }: { where?: NotificationWhere } = {}) =>
      Promise.resolve(this.rows.filter((row) => matchesNotification(row, where)).length),

    update: ({ where, data }: { where: { id: string }; data: Partial<FakeNotificationRow> }) => {
      const row = this.rows.find((candidate) => candidate.id === where.id);
      if (!row) throw new Error(`no notification ${where.id}`);
      Object.assign(row, data);
      return Promise.resolve(row);
    },
  };
}
