import {
  ATTEMPT_STATUS,
  type AdminPermissions,
  AppException,
  type AttemptStatus,
  BRANCH_TYPE,
  type BranchType,
  EXAM_COURSE,
  EXAM_MODE,
  ErrorCodes,
  type ExamCourse,
  type ExamMode,
  STAGE_DISPOSITION,
  STUDENT_TYPE,
  type StageDisposition,
  type StudentType,
} from '@iace/contracts';
import { NotificationOutbox } from '../../src/notifications/notification-outbox';
import { type Env } from '../../src/config/env.schema';
import { type AppConfigService } from '../../src/config/app-config.service';
import { type RedisService } from '../../src/redis/redis.service';
import { type MetricsService } from '../../src/common/metrics';
import { type PrismaService } from '../../src/prisma/prisma.service';
import {
  type LeaderboardService,
  type SittingStanding,
  type Standing,
} from '../../src/attempts/leaderboard.service';
import { type StorageService } from '../../src/storage/storage.service';
import {
  type MessageChannel,
  type MessageSender,
  type OutboundMessage,
} from '../../src/common/messaging';
import {
  PUSH_OUTCOMES,
  type PushOutcome,
  type PushPayload,
  type PushSender,
  type PushTarget,
} from '../../src/notifications/web-push.sender';
import { type DeviceContext } from '../../src/auth/auth.types';
import { StartingPinService } from '../../src/auth/pin/starting-pin.service';
import { type PinService } from '../../src/auth/pin/pin.service';
import {
  type DomainEventBus,
  type DomainEventName,
  type DomainEventPayloads,
} from '../../src/common/events';
import { type EventsService } from '../../src/events';
import { type ProgramsService } from '../../src/access';

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

    getdel: (key: string): Promise<string | null> => {
      const value = this.text(key) ?? null;
      this.store.delete(key);
      return Promise.resolve(value);
    },

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

  async takeJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.getdel(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  getJson<T>(key: string): Promise<T | null> {
    const raw = this.text(key);
    return Promise.resolve(raw === undefined ? null : (JSON.parse(raw) as T));
  }

  mgetJson<T>(keys: readonly string[]): Promise<(T | null)[]> {
    return Promise.resolve(
      keys.map((key) => {
        const raw = this.text(key);
        return raw === undefined ? null : (JSON.parse(raw) as T);
      }),
    );
  }

  getRaw(key: string): Promise<string | null> {
    return Promise.resolve(this.text(key) ?? null);
  }

  /** One thread, so the compare and the set are already atomic — the real one needs a script. */
  async replaceJson(key: string, was: string, value: unknown, ttlSec: number): Promise<boolean> {
    if (this.text(key) !== was) return false;
    await this.setJson(key, value, ttlSec);
    return true;
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

  /** Channels this provider pretends it cannot reach, so a fallback has something to catch. */
  constructor(private readonly unreachable: readonly MessageChannel[] = []) {}

  send(message: OutboundMessage): Promise<void> {
    if (this.unreachable.includes(message.channel)) {
      return Promise.reject(new Error(`${message.channel} is down`));
    }

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

  /** Drops what a test's SETUP published, so the assertion is about the write under test. */
  forget(): void {
    this.events.length = 0;
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

/** Enough `EventsService` for the importer: it proves the event exists and takes the roster. */
export class FakeEventsService {
  readonly added: { eventId: string; studentIds: string[] }[] = [];

  constructor(private readonly known: readonly string[] = ['evt_1']) {}

  detail(id: string): Promise<{ id: string }> {
    if (!this.known.includes(id)) {
      return Promise.reject(new AppException(ErrorCodes.NOT_FOUND, 'No such event'));
    }
    return Promise.resolve({ id });
  }

  addCandidates(eventId: string, studentIds: readonly string[]): Promise<never[]> {
    this.added.push({ eventId, studentIds: [...studentIds] });
    return Promise.resolve([]);
  }

  asService(): EventsService {
    return this as unknown as EventsService;
  }
}

/** Enough `ProgramsService` for the importer: it only ever asks whether a code can be enrolled into. */
export class FakeProgramsService {
  constructor(private readonly known: readonly string[] = ['SSC FOUNDATION']) {}

  assertUsable(codes: string[]): Promise<void> {
    const unknown = codes.filter((code) => !this.known.includes(code));
    if (unknown.length > 0) {
      return Promise.reject(new AppException(ErrorCodes.NOT_FOUND, 'No such program'));
    }
    return Promise.resolve();
  }

  asService(): ProgramsService {
    return this as unknown as ProgramsService;
  }
}

export interface FakeStudent {
  id: string;
  mobile: string;
  pinHash: string | null;
  fullName: string | null;
  studentType: StudentType;
  enrolledExams: string[];
  enrolledCourses: ExamCourse[];
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
  /** The events they are a candidate on, as `detail` includes them. Absent reads as none. */
  eventCandidacies?: { event: { id: string; name: string } }[];
  deletedAt: Date | null;
  /** Set by an erasure request. Separate from deletedAt: closed and erased are different facts. */
  anonymizedAt?: Date | null;
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
    enrolledCourses: [],
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

/** The branch filters the fakes answer: the list's own, plus the scope's `id in`. */
interface FakeBranchWhere {
  isActive?: boolean;
  name?: { contains: string };
  id?: { in: string[] };
}

function matchesBranch(branch: FakeBranch, where: FakeBranchWhere): boolean {
  return (
    (where.isActive === undefined || branch.isActive === where.isActive) &&
    (where.name?.contains === undefined ||
      branch.name.toLowerCase().includes(where.name.contains.toLowerCase())) &&
    (where.id === undefined || where.id.in.includes(branch.id))
  );
}

/** The student filters the fakes answer: the `in` lookups, an enrolment, a branch, and live-only. */
interface StudentWhere {
  id?: string | { in: string[] };
  mobile?: string | { in: string[] };
  enrolledExams?: { has: string };
  currentBranchId?: { in: string[] };
  deletedAt?: null;
}

/** `in: []` matches nothing, as Prisma compiles it — an admin with no branch reaches no student. */
function inBranch(student: FakeStudent, filter: { in: string[] } | undefined): boolean {
  if (!filter) return true;
  return student.currentBranchId !== null && filter.in.includes(student.currentBranchId);
}

function matchesStudent(student: FakeStudent, where: StudentWhere): boolean {
  return (
    matchesKey(student.id, where.id) &&
    matchesKey(student.mobile, where.mobile) &&
    (where.enrolledExams ? student.enrolledExams.includes(where.enrolledExams.has) : true) &&
    inBranch(student, where.currentBranchId) &&
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
  return {
    ...student,
    profile: student.profile ? { ...student.profile } : null,
    eventCandidacies: student.eventCandidacies ?? [],
  };
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

/** A sitting as the admin report's picker reads it, with its test's title on the row. */
export interface FakeReportSitting {
  id: string;
  studentId: string;
  status: AttemptStatus;
  submittedAt: Date | null;
  title: string | null;
  isGraded: boolean;
}

export function makeReportSitting(overrides: Partial<FakeReportSitting> = {}): FakeReportSitting {
  return {
    id: 'att_1',
    studentId: 'stu_1',
    status: ATTEMPT_STATUS.EVALUATED,
    submittedAt: new Date('2026-08-20T06:00:00.000Z'),
    title: 'SSC CGL Tier 1 — Mock 1',
    isGraded: true,
    ...overrides,
  };
}

interface ReportSittingWhere {
  studentId: string;
  status: AttemptStatus;
  test?: { title: { contains: string } };
}

/** Just enough Prisma for the auth service: find by unique key, and upsert. */
export class FakePrisma {
  private readonly outbox = fakeOutboxTable();

  readonly outboxEvents = this.outbox.rows;

  readonly outboxEvent = this.outbox.api;

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

    findMany: ({ where = {} }: { where?: FakeBranchWhere } = {}) =>
      Promise.resolve(this.branches.filter((b) => matchesBranch(b, where))),

    // The same `where` the rows came off: a count that ignored it would promise unreachable pages.
    count: ({ where = {} }: { where?: FakeBranchWhere } = {}) =>
      Promise.resolve(this.branches.filter((b) => matchesBranch(b, where)).length),

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
        ? { id: exam.id, code: exam.code, name: exam.name, course: exam.course }
        : { id: row.examId, code: '', name: '', course: EXAM_COURSE.SSC },
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

  readonly reportSittings: FakeReportSitting[] = [];

  private reportSittingsWhere(where: ReportSittingWhere): FakeReportSitting[] {
    const needle = where.test?.title.contains.toLowerCase();
    return this.reportSittings.filter(
      (row) =>
        row.studentId === where.studentId &&
        row.status === where.status &&
        // Postgres never matches NULL against `contains`, so an untitled test drops out of a search.
        (needle === undefined || (row.title?.toLowerCase().includes(needle) ?? false)),
    );
  }

  readonly attempt = {
    findMany: ({
      where,
      skip = 0,
      take,
    }: {
      where: ReportSittingWhere;
      skip?: number;
      take?: number;
    }) =>
      Promise.resolve(
        this.reportSittingsWhere(where)
          .toSorted((a, b) => (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0))
          .slice(skip, take === undefined ? undefined : skip + take)
          .map((row) => ({
            id: row.id,
            submittedAt: row.submittedAt,
            isGraded: row.isGraded,
            test: { title: row.title },
          })),
      ),

    count: ({ where }: { where: ReportSittingWhere }) =>
      Promise.resolve(this.reportSittingsWhere(where).length),
  };

  /** Both forms: the array a paged read uses, and the callback a write-plus-request runs in. */
  $transaction = <T>(work: Promise<T>[] | ((tx: FakePrisma) => Promise<T>)): Promise<T[] | T> =>
    typeof work === 'function' ? work(this) : Promise.all(work);

  asService(): PrismaService {
    return this as unknown as PrismaService;
  }
}

/** A queue that only remembers, and collapses a held job id the way BullMQ silently does. */
/** What a processor tells that a job threw. Records, so a test can assert the last word on one. */
export class FakeQueueFailures {
  readonly recorded: { queue: string; jobId: string; message: string }[] = [];

  record(
    queue: string,
    job: { id?: string; attemptsMade: number; opts: { attempts?: number } } | undefined,
    error: Error,
  ): void {
    this.recorded.push({ queue, jobId: job?.id ?? 'unknown', message: error.message });
  }

  asService<T>(): T {
    return this as unknown as T;
  }
}

/** The one every test that only needs a processor to construct can hand it. */
export const fakeQueueFailures = <T>(): T => new FakeQueueFailures().asService<T>();

export class FakeQueue {
  readonly jobs: {
    name: string;
    data: unknown;
    jobId?: string;
    removeOnComplete?: boolean;
    removeOnFail?: boolean;
  }[] = [];

  /** Set to make the next add throw: the crash between a commit and the queue. */
  failNext = false;

  add(
    name: string,
    data: unknown,
    options?: { jobId?: string; removeOnComplete?: boolean; removeOnFail?: boolean },
  ): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('queue unreachable'));
    }
    // BullMQ 6 refuses this at add time; a fake that accepted it hid a rebuild that never queued.
    if (options?.jobId?.includes(':') && options.jobId.split(':').length !== 3) {
      return Promise.reject(new Error('Custom Id cannot contain :'));
    }
    // BullMQ drops an add whose job hash still exists, and resolves as though it had queued it.
    if (options?.jobId !== undefined && this.jobs.some((job) => job.jobId === options.jobId)) {
      return Promise.resolve();
    }
    const removeOnComplete =
      options?.removeOnComplete === undefined ? {} : { removeOnComplete: options.removeOnComplete };
    const removeOnFail =
      options?.removeOnFail === undefined ? {} : { removeOnFail: options.removeOnFail };
    this.jobs.push({ name, data, jobId: options?.jobId, ...removeOnComplete, ...removeOnFail });
    return Promise.resolve();
  }

  asQueue<T>(): T {
    return this as unknown as T;
  }
}

/** The filters the relay and the pruner narrow `OutboxEvent` by. */
interface FakeOutboxWhere {
  eventType?: string;
  id?: string;
  aggregateId?: { in: string[] };
  createdAt?: { lt: Date };
  processedAt?: null | { not?: null; lt?: Date };
}

/** Pending is `processedAt: null`; the pruner asks for the opposite, before a cutoff. */
function matchesOutboxWhere(row: FakeOutboxRow, where: FakeOutboxWhere): boolean {
  if (where.eventType !== undefined && row.eventType !== where.eventType) return false;
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.aggregateId && !where.aggregateId.in.includes(row.aggregateId)) return false;
  if (where.createdAt && row.createdAt >= where.createdAt.lt) return false;
  if (where.processedAt === null) return row.processedAt === null;
  if (where.processedAt?.lt) {
    return row.processedAt !== null && row.processedAt < where.processedAt.lt;
  }
  return true;
}

/** What a caller hands `create`: the row without the three columns the table fills in. */
type FakeOutboxInput = Omit<FakeOutboxRow, 'id' | 'createdAt' | 'processedAt'>;

/** One OutboxEvent table any fake can hold, now that producers write a request beside their row. */
export function fakeOutboxTable() {
  const rows: FakeOutboxRow[] = [];
  let seq = 0;

  const insert = (data: FakeOutboxInput): FakeOutboxRow => {
    seq += 1;
    const created: FakeOutboxRow = {
      ...data,
      id: `obx_${seq}`,
      createdAt: new Date(seq),
      processedAt: null,
    };
    rows.push(created);
    return created;
  };

  return {
    rows,
    api: {
      create: ({ data }: { data: FakeOutboxInput }) => Promise.resolve({ id: insert(data).id }),

      createMany: ({ data }: { data: FakeOutboxInput[] }) => {
        data.forEach(insert);
        return Promise.resolve({ count: data.length });
      },

      findMany: ({ where, take }: { where: FakeOutboxWhere; take?: number }) =>
        Promise.resolve(
          rows
            .filter((row) => matchesOutboxWhere(row, where))
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
            .slice(0, take),
        ),

      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(rows.find((row) => row.id === where.id) ?? null),

      update: ({ where, data }: { where: { id: string }; data: Partial<FakeOutboxRow> }) => {
        const row = rows.find((candidate) => candidate.id === where.id);
        if (!row) throw new Error(`no outbox event ${where.id}`);
        Object.assign(row, data);
        return Promise.resolve(row);
      },
    },
  };
}

/** A durable event waiting to be handed to a queue. */
export interface FakeOutboxRow {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  createdAt: Date;
  processedAt: Date | null;
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
/** The REAL service over a fake hash and sender: a starting PIN is a rule worth exercising, not stubbing. */
export function fakeStartingPins(
  sender: MessageSender = new FakeMessageSender(),
  hash: (pin: string) => Promise<string> = (pin) => Promise.resolve(`hash:${pin}`),
): StartingPinService {
  return new StartingPinService({ hash } as unknown as PinService, sender);
}

/** A roster CSV with the demanded columns filled, so a test varies only what it is about. */
export function roster(csv: string): string {
  const REQUIRED_HEADERS = 'Student Type,Branch Name,Enrolled Courses,Enrolled Exams,Programs';
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
  course: ExamCourse;
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
    course: EXAM_COURSE.SSC,
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

type Contains = { contains: string; mode?: 'insensitive' };

interface StageWhere {
  AND?: StageWhere[];
  OR?: StageWhere[];
  name?: Contains;
  stageKey?: Contains;
  examId?: KeyFilter;
  exam?: { course?: ExamCourse; code?: Contains };
  disposition?: StageDisposition;
  isActive?: boolean;
}

function holds(value: string | undefined, filter: Contains | undefined): boolean {
  if (!filter) return true;
  return (value ?? '').toLowerCase().includes(filter.contains.toLowerCase());
}

function matchesStage(stage: FakeExamStage, where: StageWhere, exams: FakeExam[]): boolean {
  const exam = exams.find((candidate) => candidate.id === stage.examId);
  return (
    (where.AND ?? []).every((clause) => matchesStage(stage, clause, exams)) &&
    (where.OR === undefined || where.OR.some((clause) => matchesStage(stage, clause, exams))) &&
    holds(stage.name, where.name) &&
    holds(stage.stageKey, where.stageKey) &&
    matchesKey(stage.examId, where.examId) &&
    (where.exam?.course === undefined || exam?.course === where.exam.course) &&
    holds(exam?.code, where.exam?.code) &&
    (where.disposition === undefined || stage.disposition === where.disposition) &&
    (where.isActive === undefined || stage.isActive === where.isActive)
  );
}

interface ExamWhere {
  name?: { contains: string; mode?: 'insensitive' };
  code?: { in: string[] };
  course?: KeyFilter;
  isActive?: boolean;
}

function matchesExam(exam: FakeExam, where: ExamWhere): boolean {
  return (
    (where.name ? exam.name.toLowerCase().includes(where.name.contains.toLowerCase()) : true) &&
    (where.code ? where.code.in.includes(exam.code) : true) &&
    matchesKey(exam.course, where.course) &&
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

/** The admins facade as auth sees it: the grant map a token carries. */
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

  /** Names for the codes it knows; an unknown one is absent, which is what the resolver falls back on. */
  namesByCode(codes: readonly string[]): Promise<Map<string, string>> {
    return Promise.resolve(
      new Map(
        codes.filter((code) => this.usable.includes(code)).map((code) => [code, `${code} name`]),
      ),
    );
  }

  asService<T>(): T {
    return this as unknown as T;
  }
}

/** Records what would have gone out, and pretends any endpoint named is dead or unreachable. */
export class FakePushSender implements PushSender {
  readonly sent: { endpoint: string; payload: PushPayload }[] = [];

  constructor(
    readonly isConfigured = true,
    private readonly gone: readonly string[] = [],
    private readonly failing: readonly string[] = [],
  ) {}

  send(target: PushTarget, payload: PushPayload): Promise<PushOutcome> {
    if (this.gone.includes(target.endpoint)) return Promise.resolve(PUSH_OUTCOMES.GONE);
    if (this.failing.includes(target.endpoint)) return Promise.resolve(PUSH_OUTCOMES.FAILED);

    this.sent.push({ endpoint: target.endpoint, payload });
    return Promise.resolve(PUSH_OUTCOMES.SENT);
  }
}

// --------------------------------------------------------------------------- scoring
// ---------------------------------------------------------------------------

/** For the services that now take one only to write a request beside their own row. */
export function fakeNotificationOutbox(prisma?: {
  asService(): PrismaService;
}): NotificationOutbox {
  // A caller writes its request through its own transaction; only a relay reads the outbox's store.
  const store = prisma?.asService() ?? ({ outboxEvent: fakeOutboxTable().api } as never);
  return new NotificationOutbox(store, new FakeQueue().asQueue());
}

/** A sitting's standing and the student it belongs to, as the live ranking would count it. */
export interface FakeStanding extends SittingStanding {
  studentId: string;
}

export function makeStanding(overrides: Partial<FakeStanding> = {}): FakeStanding {
  return {
    attemptId: 'att_1',
    testId: 'tst_1',
    studentId: 'stu_1',
    rank: 1,
    percentile: 100,
    cohortSize: 1,
    ...overrides,
  };
}

/** The live ranking as its consumers see it. Postgres counts it, so a test fills the maps in. */
export class FakeLeaderboard implements Pick<
  LeaderboardService,
  'standing' | 'standingsOfStudent' | 'sittingCounts'
> {
  readonly standings = new Map<string, FakeStanding>();
  readonly counts = new Map<string, number>();

  constructor(standings: readonly FakeStanding[] = [], counts: Record<string, number> = {}) {
    for (const standing of standings) this.standings.set(standing.attemptId, standing);
    for (const [testId, count] of Object.entries(counts)) this.counts.set(testId, count);
  }

  standing(testId: string, attemptId: string): Promise<Standing | null> {
    const held = this.standings.get(attemptId);
    if (held?.testId !== testId) return Promise.resolve(null);
    return Promise.resolve({
      rank: held.rank,
      percentile: held.percentile,
      cohortSize: held.cohortSize,
    });
  }

  standingsOfStudent(studentId: string): Promise<ReadonlyMap<string, SittingStanding>> {
    const mine = [...this.standings.values()].filter((held) => held.studentId === studentId);
    return Promise.resolve(
      new Map(
        mine.map((held) => [
          held.attemptId,
          {
            attemptId: held.attemptId,
            testId: held.testId,
            rank: held.rank,
            percentile: held.percentile,
            cohortSize: held.cohortSize,
          },
        ]),
      ),
    );
  }

  sittingCounts(testIds: readonly string[]): Promise<ReadonlyMap<string, number>> {
    const counted = testIds.flatMap((testId) => {
      const count = this.counts.get(testId);
      return count === undefined ? [] : [[testId, count] as const];
    });
    return Promise.resolve(new Map(counted));
  }

  asService(): LeaderboardService {
    return this as unknown as LeaderboardService;
  }
}

/** The row a fixture was built with. Throws rather than asserts, so a bad setup names itself. */
export function rowAt<T>(rows: readonly T[], index = 0): T {
  const row = rows[index];
  if (row === undefined) throw new Error(`This fixture has no row ${index}`);
  return row;
}

/** Counting is not what a submit test is about, so the fake only has to be silent. */
export class FakeMetrics {
  readonly submits: string[] = [];

  readonly queueFailures: { queue: string; spent: boolean }[] = [];

  countSubmit(outcome: string): void {
    this.submits.push(outcome);
  }

  countQueueFailure(queue: string, spent: boolean): void {
    this.queueFailures.push({ queue, spent });
  }

  observeRequest(): void {
    // A unit test never goes through the interceptor.
  }

  asService(): MetricsService {
    return this as unknown as MetricsService;
  }
}
