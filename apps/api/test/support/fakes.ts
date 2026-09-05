import {
  ANSWER_STATE,
  ATTEMPT_STATUS,
  type AdminPermissions,
  type AnswerState,
  type AttemptSectionScore,
  AppException,
  type AttemptStatus,
  BRANCH_TYPE,
  type BranchType,
  DIFFICULTY_LEVEL,
  type DifficultyLevel,
  type DrawSpec,
  EVALUATION_MODE,
  EXAM_COURSE,
  EXAM_MODE,
  EXAM_TEMPLATE,
  ErrorCodes,
  type EvaluationMode,
  type ExamCourse,
  type ExamMode,
  type ExamTemplate,
  type FeatureKey,
  LANGUAGE_CODE,
  LANGUAGE_MODE,
  type LanguageCode,
  type LanguageMode,
  MERIT_TYPE,
  type MeritType,
  NAVIGATION_POLICY,
  type NavigationPolicy,
  type NotificationType,
  PAPER_BINDING,
  PAPER_QUESTION_STATUS,
  type PaperBinding,
  type PaperQuestionStatus,
  type PermissionLevel,
  QUESTION_TYPE,
  type QuestionType,
  STAGE_DISPOSITION,
  STUDENT_TYPE,
  type StageDisposition,
  type StudentType,
  TEST_SCOPE,
  TEST_SERIES_KIND,
  TEST_STATUS,
  TEST_UI,
  TIMER_TEMPLATE,
  type TestScope,
  type TestScopeRef,
  type TestSeriesKind,
  type TestStatus,
  type TestUi,
  type TimerTemplate,
} from '@iace/contracts';
import { Prisma } from '@prisma/client';
import { ScoringOutbox } from '../../src/attempts/scoring-outbox';
import { RollupOutbox } from '../../src/attempts/rollup-outbox';
import { type Env } from '../../src/config/env.schema';
import { type AppConfigService } from '../../src/config/app-config.service';
import { type RedisService } from '../../src/redis/redis.service';
import { type MetricsService } from '../../src/common/metrics';
import { type PrismaService } from '../../src/prisma/prisma.service';
import { type StorageService } from '../../src/storage/storage.service';
import { type MessageSender, type OutboundMessage } from '../../src/common/messaging';
import { type DeviceContext } from '../../src/auth/auth.types';
import { StartingPinService } from '../../src/auth/pin/starting-pin.service';
import { type PinService } from '../../src/auth/pin/pin.service';
import {
  type DomainEventBus,
  type DomainEventName,
  type DomainEventPayloads,
} from '../../src/common/events';
import { type EventsService } from '../../src/events';

/** Test doubles for the three things the auth services touch: Redis, config and Postgres. */

interface Entry {
  value: string | Set<string> | Map<string, number>;
  expiresAtMs: number | null;
}

/** `-inf`, `+inf`, a number, or a `(`-prefixed exclusive bound — the ZCOUNT range vocabulary. */
function zBound(raw: string | number): { at: number; exclusive: boolean } {
  const text = String(raw);
  const exclusive = text.startsWith('(');
  const body = exclusive ? text.slice(1) : text;
  if (body === '-inf') return { at: Number.NEGATIVE_INFINITY, exclusive };
  if (body === '+inf' || body === 'inf') return { at: Number.POSITIVE_INFINITY, exclusive };
  return { at: Number(body), exclusive };
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
      if (entry.value instanceof Map) continue;
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

    zadd: (key: string, ...pairs: (number | string)[]): Promise<number> => {
      const entry = this.live(key);
      const zset = entry?.value instanceof Map ? entry.value : new Map<string, number>();
      let added = 0;
      for (let at = 0; at + 1 < pairs.length; at += 2) {
        const member = String(pairs[at + 1]);
        if (!zset.has(member)) added += 1;
        zset.set(member, Number(pairs[at]));
      }
      this.store.set(key, { value: zset, expiresAtMs: entry?.expiresAtMs ?? null });
      return Promise.resolve(added);
    },

    zscore: (key: string, member: string): Promise<string | null> => {
      const score = this.zset(key).get(member);
      return Promise.resolve(score === undefined ? null : String(score));
    },

    rename: (from: string, to: string): Promise<'OK'> => {
      const entry = this.live(from);
      if (!entry) throw new Error(`no such key ${from}`);
      this.store.set(to, entry);
      this.store.delete(from);
      return Promise.resolve('OK');
    },

    zcard: (key: string): Promise<number> => Promise.resolve(this.zset(key).size),

    /** Highest score is seat 0; Redis orders a tie by member ascending, so REV reverses that too. */
    zrevrank: (key: string, member: string): Promise<number | null> => {
      const seat = this.descending(key).indexOf(member);
      return Promise.resolve(seat === -1 ? null : seat);
    },

    /** Best first, inclusive at both ends — the slice a board's podium and neighbourhood are cut from. */
    zrevrange: (key: string, start: number, stop: number): Promise<string[]> =>
      Promise.resolve(this.descending(key).slice(start, stop < 0 ? undefined : stop + 1)),

    zcount: (key: string, min: string | number, max: string | number): Promise<number> => {
      const low = zBound(min);
      const high = zBound(max);
      const inRange = [...this.zset(key).values()].filter(
        (score) =>
          (low.exclusive ? score > low.at : score >= low.at) &&
          (high.exclusive ? score < high.at : score <= high.at),
      );
      return Promise.resolve(inRange.length);
    },
  };

  private zset(key: string): Map<string, number> {
    const entry = this.live(key);
    return entry?.value instanceof Map ? entry.value : new Map<string, number>();
  }

  /** The board as a reader sees it, best first — and a tie the way ZREVRANGE returns one. */
  descending(key: string): string[] {
    return [...this.zset(key).entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))
      .map(([member]) => member);
  }

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
  /** Every branch, said out loud. False with no `AdminBranch` rows reaches none. */
  allBranches: boolean;
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
    allBranches: false,
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
  examTemplate: ExamTemplate;
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
    examTemplate: EXAM_TEMPLATE.DEFAULT,
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

  /** The tables a rollback has to put back. A subclass adding one overrides this. */
  protected tables(): object[][] {
    return [this.configs, this.sections, this.modules];
  }

  /** Callbacks run one at a time: two that interleave are not transactions, whatever they roll back. */
  private serialized: Promise<unknown> = Promise.resolve();

  /** Both forms, and a throwing callback puts every table back — services rely on that. */
  $transaction<T>(work: Promise<T>[] | ((tx: FakeConfigPrisma) => Promise<T>)): Promise<T[] | T> {
    if (typeof work !== 'function') return Promise.all(work);

    const run = async (): Promise<T> => {
      const tables = this.tables();
      const snapshot = tables.map((rows) => rows.map((row) => structuredClone(row)));
      try {
        return await work(this);
      } catch (error) {
        tables.forEach((rows, index) => {
          rows.length = 0;
          rows.push(...(snapshot[index] ?? []));
        });
        throw error;
      }
    };

    const next = this.serialized.then(run, run);
    this.serialized = next.catch(() => undefined);
    return next;
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
      where: {
        examStageId?: string;
        isDefault?: boolean;
        locked?: boolean;
        id?: string | { not: string };
      };
      data: { isDefault?: boolean; locked?: boolean };
    }) => {
      const only = typeof where.id === 'string' ? where.id : undefined;
      const except = typeof where.id === 'object' ? where.id.not : undefined;
      const matched = this.configs.filter(
        (config) =>
          (where.examStageId === undefined || config.examStageId === where.examStageId) &&
          (where.isDefault === undefined || config.isDefault === where.isDefault) &&
          (where.locked === undefined || config.locked === where.locked) &&
          (only === undefined || config.id === only) &&
          (except === undefined || config.id !== except),
      );
      for (const config of matched) {
        if (data.isDefault !== undefined) config.isDefault = data.isDefault;
        if (data.locked !== undefined) config.locked = data.locked;
      }
      return Promise.resolve({ count: matched.length });
    },

    delete: ({ where }: { where: { id: string } }) => {
      const index = this.configs.findIndex((config) => config.id === where.id);
      const [removed] = this.configs.splice(index, 1);
      return Promise.resolve(removed);
    },
  };

  readonly baseConfigSection = {
    findUnique: ({ where }: { where: { id: string } }) =>
      Promise.resolve(this.sections.find((row) => row.id === where.id) ?? null),

    findMany: ({ where }: { where: { baseConfigId: string } }) =>
      Promise.resolve(
        this.sections
          .filter((row) => row.baseConfigId === where.baseConfigId)
          .sort((a, b) => a.order - b.order),
      ),

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
          ? { id: exam.id, code: exam.code, name: exam.name, course: exam.course }
          : { id: '', code: '', name: '', course: EXAM_COURSE.SSC },
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

/** A `Test` row as the tests module reads it — its shape stays on the config it points at. */
export interface FakeTestModelRow {
  id: string;
  title: string | null;
  baseConfigId: string;
  examTemplate: ExamTemplate;
  examStageId: string;
  scope: TestScope;
  scopeRef: TestScopeRef | null;
  evaluationMode: EvaluationMode;
  paperBinding: PaperBinding;
  maxRetakes: number | null;
  questionPoolFilter: DrawSpec | null;
  variantCount: number;
  status: TestStatus;
  isLocked: boolean;
  version: number;
  finalizedAt: Date | null;
  createdById: string | null;
  createdAt: Date;
  testSeriesId: string | null;
  seriesOrder: number | null;
  opensAt: Date | null;
  lateEntrySec: number | null;
  extraTimeSec: number | null;
}

export function makeTest(overrides: Partial<FakeTestModelRow> = {}): FakeTestModelRow {
  return {
    id: 'tst_1',
    title: 'SSC CGL Tier 1 — Mock 1',
    baseConfigId: 'cfg_1',
    examTemplate: EXAM_TEMPLATE.DEFAULT,
    examStageId: 'stage_1',
    scope: TEST_SCOPE.FULL,
    scopeRef: null,
    evaluationMode: EVALUATION_MODE.RANKED,
    paperBinding: PAPER_BINDING.FIXED,
    maxRetakes: null,
    variantCount: 1,
    questionPoolFilter: null,
    status: TEST_STATUS.DRAFT,
    isLocked: false,
    version: 0,
    finalizedAt: null,
    createdById: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    testSeriesId: null,
    seriesOrder: null,
    opensAt: null,
    lateEntrySec: null,
    extraTimeSec: null,
    ...overrides,
  };
}

const ONE_HOUR_MS = 3_600_000;

/** The version a served question pins — content and options exactly as the column holds them. */
export interface FakeServedVersion {
  id: string;
  content: unknown;
  options: unknown;
}

/** A live sitting. The clock columns are the server's, never a request's. */
export interface FakeAttemptRow {
  id: string;
  testId: string;
  studentId: string;
  attemptNo: number;
  isGraded: boolean;
  status: AttemptStatus;
  startedAt: Date;
  endsAt: Date;
  submittedAt: Date | null;
  evaluatedAt: Date | null;
  shuffleSeed: number;
  languages: LanguageCode[];
  score: number | null;
  correctCount: number | null;
  wrongCount: number | null;
  unattemptedCount: number | null;
  sectionScores: AttemptSectionScore[] | null;
  lastRank: number | null;
  lastPercentile: number | null;
  createdAt: Date;
}

export function makeAttempt(overrides: Partial<FakeAttemptRow> = {}): FakeAttemptRow {
  const startedAt = overrides.startedAt ?? new Date('2026-08-24T04:00:00.000Z');
  return {
    id: 'att_1',
    testId: 'tst_1',
    studentId: 'stu_1',
    attemptNo: 1,
    isGraded: true,
    status: ATTEMPT_STATUS.IN_PROGRESS,
    startedAt,
    endsAt: new Date(startedAt.getTime() + ONE_HOUR_MS),
    submittedAt: null,
    evaluatedAt: null,
    shuffleSeed: 7,
    languages: [LANGUAGE_CODE.EN],
    score: null,
    correctCount: null,
    wrongCount: null,
    unattemptedCount: null,
    sectionScores: null,
    lastRank: null,
    lastPercentile: null,
    createdAt: startedAt,
    ...overrides,
  };
}

/** One question served in a sitting, before anyone has answered it. */
export interface FakeAttemptQuestionRow {
  attemptId: string;
  questionId: string;
  paperQuestionId: string | null;
  questionVersionId: string;
  baseConfigSectionId: string;
  order: number;
  selectedOptionId: string | null;
  typedAnswer: string | null;
  state: AnswerState;
  timeSpentSec: number;
  answeredAt?: Date | null;
}

/** A queue that only remembers. Every add is recorded, so two hand-offs never read as one. */
export class FakeQueue {
  readonly jobs: { name: string; data: unknown; jobId?: string }[] = [];

  /** Set to make the next add throw: the crash between a commit and the queue. */
  failNext = false;

  add(name: string, data: unknown, options?: { jobId?: string }): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('queue unreachable'));
    }
    this.jobs.push({ name, data, jobId: options?.jobId });
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

/** A row of a draft paper, before finalize freezes it. */
export interface FakePaperRow {
  id: string;
  testId: string;
  baseConfigId: string;
  baseConfigSectionId: string;
  questionId: string;
  questionVersionId: string;
  variant: number;
  order: number;
  marks: number;
  negativeMarks: number;
  status: PaperQuestionStatus;
}

/** The configs fake plus the `Test` table, because a test is only ever read through its config. */
export class FakeTestsPrisma extends FakeConfigPrisma {
  private testSeq = 0;

  constructor(
    readonly tests: FakeTestModelRow[] = [],
    configs: FakeBaseConfigRow[] = [makeBaseConfig()],
    sections: FakeSectionRow[] = [makeSection()],
    readonly attempts: { testId: string }[] = [],
    readonly questions: FakeQuestionRow[] = [],
    readonly paperQuestions: FakePaperRow[] = [],
    readonly series: FakeSeriesRow[] = [],
    readonly attemptRows: FakeAttemptRow[] = [],
    readonly attemptQuestions: FakeAttemptQuestionRow[] = [],
    readonly questionVersions: FakeServedVersion[] = [],
    readonly branchNames: FakeBranch[] = [],
  ) {
    super(configs, sections);
  }

  readonly branch = {
    findFirst: ({ where }: { where: { id: string } }) =>
      Promise.resolve(this.branchNames.find((row) => row.id === where.id) ?? null),
  };

  readonly programCatalog: { code: string }[] = [];

  readonly programUnlocks: { testId: string; programCode: string; opensAt: Date }[] = [];

  readonly program = {
    findUnique: ({ where }: { where: { code: string } }) =>
      Promise.resolve(this.programCatalog.find((row) => row.code === where.code) ?? null),
  };

  readonly testProgramUnlock = {
    findMany: ({ where }: { where: { testId: string } }) =>
      Promise.resolve(
        this.programUnlocks
          .filter((row) => row.testId === where.testId)
          .sort((a, b) => a.programCode.localeCompare(b.programCode)),
      ),

    upsert: ({
      where,
      update,
      create,
    }: {
      where: { testId_programCode: { testId: string; programCode: string } };
      update: { opensAt: Date };
      create: { testId: string; programCode: string; opensAt: Date };
    }) => {
      const { testId, programCode } = where.testId_programCode;
      const held = this.programUnlocks.find(
        (row) => row.testId === testId && row.programCode === programCode,
      );
      if (held) held.opensAt = update.opensAt;
      else this.programUnlocks.push(create);
      return Promise.resolve(held ?? create);
    },

    deleteMany: ({
      where,
    }: {
      where: { testId: string; programCode?: string; opensAt?: { gt: Date } };
    }) => {
      const kept = this.programUnlocks.filter(
        (row) =>
          !(
            row.testId === where.testId &&
            (where.programCode === undefined || row.programCode === where.programCode) &&
            (where.opensAt === undefined || row.opensAt > where.opensAt.gt)
          ),
      );
      const count = this.programUnlocks.length - kept.length;
      this.programUnlocks.length = 0;
      this.programUnlocks.push(...kept);
      return Promise.resolve({ count });
    },
  };

  private attemptSeq = 0;

  readonly attemptQuestion = {
    createMany: ({
      data,
    }: {
      data: Omit<
        FakeAttemptQuestionRow,
        'selectedOptionId' | 'typedAnswer' | 'state' | 'timeSpentSec'
      >[];
    }) => {
      for (const row of data) {
        this.attemptQuestions.push({
          ...row,
          selectedOptionId: null,
          typedAnswer: null,
          state: ANSWER_STATE.NOT_VISITED,
          timeSpentSec: 0,
        });
      }
      return Promise.resolve({ count: data.length });
    },

    findMany: ({
      where,
    }: {
      where: {
        attemptId?: string;
        questionId?: string;
        attempt?: { testId?: string; status: { in: AttemptStatus[] } };
      };
      distinct?: string[];
    }) => {
      const sittingOf = (row: FakeAttemptQuestionRow) =>
        this.attemptRows.find((candidate) => candidate.id === row.attemptId);
      const reachable = (row: FakeAttemptQuestionRow) => {
        if (!where.attempt) return true;
        const sitting = sittingOf(row);
        if (!sitting) return false;
        const onTest =
          where.attempt.testId === undefined || sitting.testId === where.attempt.testId;
        return onTest && where.attempt.status.in.includes(sitting.status);
      };
      const matched = this.attemptQuestions
        .filter(
          (row) =>
            (where.attemptId === undefined || row.attemptId === where.attemptId) &&
            (where.questionId === undefined || row.questionId === where.questionId) &&
            reachable(row),
        )
        .sort((a, b) => a.order - b.order);
      if (!where.attempt) return Promise.resolve(matched);

      // The re-score read asks for the SITTING behind each row, once per sitting.
      const seen = new Set<string>();
      return Promise.resolve(
        matched
          .filter((row) => !seen.has(row.attemptId) && seen.add(row.attemptId) !== undefined)
          .map((row) => ({ attemptId: row.attemptId })),
      );
    },

    count: ({ where }: { where: { attemptId: string; state: { in: AnswerState[] } } }) =>
      Promise.resolve(
        this.attemptQuestions.filter(
          (row) => row.attemptId === where.attemptId && where.state.in.includes(row.state),
        ).length,
      ),

    updateMany: ({
      where,
      data,
    }: {
      where: { attemptId: string; questionId: string; attempt?: { status: AttemptStatus } };
      data: Partial<FakeAttemptQuestionRow>;
    }) => {
      const sitting = this.attemptRows.find((row) => row.id === where.attemptId);
      const live = where.attempt === undefined || sitting?.status === where.attempt.status;
      const matched = live
        ? this.attemptQuestions.filter(
            (row) => row.attemptId === where.attemptId && row.questionId === where.questionId,
          )
        : [];
      for (const row of matched) Object.assign(row, data);
      return Promise.resolve({ count: matched.length });
    },
  };

  protected override tables(): object[][] {
    return [
      ...super.tables(),
      this.tests,
      this.questions,
      this.paperQuestions,
      this.series,
      this.attemptRows,
      this.attemptQuestions,
      this.outboxEvents,
    ];
  }

  readonly outboxEvents: FakeOutboxRow[] = [];

  private outboxSeq = 0;

  readonly outboxEvent = {
    create: ({ data }: { data: FakeOutboxInput }) => {
      this.outboxSeq += 1;
      const created: FakeOutboxRow = {
        ...data,
        id: `obx_${this.outboxSeq}`,
        createdAt: new Date(this.outboxSeq),
        processedAt: null,
      };
      this.outboxEvents.push(created);
      return Promise.resolve({ id: created.id });
    },

    findMany: ({
      where,
      orderBy,
      take,
    }: {
      where: FakeOutboxWhere;
      orderBy?: { createdAt?: 'asc' } | { processedAt?: 'asc' };
      take?: number;
    }) => {
      const by = orderBy && 'processedAt' in orderBy ? 'processedAt' : 'createdAt';
      return Promise.resolve(
        this.outboxEvents
          .filter((row) => matchesOutboxWhere(row, where))
          .sort((a, b) => (a[by]?.getTime() ?? 0) - (b[by]?.getTime() ?? 0))
          .slice(0, take),
      );
    },

    createMany: ({ data }: { data: FakeOutboxInput[] }) => {
      for (const row of data) {
        this.outboxSeq += 1;
        this.outboxEvents.push({
          ...row,
          id: `obx_${this.outboxSeq}`,
          createdAt: new Date(this.outboxSeq),
          processedAt: null,
        });
      }
      return Promise.resolve({ count: data.length });
    },

    deleteMany: ({ where }: { where: { id: { in: string[] } } }) => {
      const kept = this.outboxEvents.filter((row) => !where.id.in.includes(row.id));
      const count = this.outboxEvents.length - kept.length;
      this.outboxEvents.length = 0;
      this.outboxEvents.push(...kept);
      return Promise.resolve({ count });
    },

    update: ({ where, data }: { where: { id: string }; data: { processedAt: Date } }) => {
      const row = this.outboxEvents.find((candidate) => candidate.id === where.id);
      if (!row) throw new Error(`no outbox row ${where.id}`);
      row.processedAt = data.processedAt;
      return Promise.resolve(row);
    },
  };

  readonly attempt = {
    findUnique: ({ where }: { where: { id: string } }) =>
      Promise.resolve(this.attemptRows.find((row) => row.id === where.id) ?? null),

    findMany: ({
      where,
      take,
    }: {
      where: {
        status: AttemptStatus;
        endsAt?: { lt: Date };
        score?: null;
        submittedAt?: { lt: Date };
      };
      take?: number;
    }) =>
      Promise.resolve(
        this.attemptRows
          .filter(
            (row) =>
              row.status === where.status &&
              (where.endsAt === undefined || row.endsAt < where.endsAt.lt) &&
              (where.score === undefined || row.score === null) &&
              (where.submittedAt === undefined ||
                (row.submittedAt !== null && row.submittedAt < where.submittedAt.lt)),
          )
          .slice(0, take),
      ),

    updateMany: ({
      where,
      data,
    }: {
      where: { id: string; status: AttemptStatus };
      data: { status: AttemptStatus; submittedAt: Date };
    }) => {
      const matched = this.attemptRows.filter(
        (row) => row.id === where.id && row.status === where.status,
      );
      for (const row of matched) Object.assign(row, data);
      return Promise.resolve({ count: matched.length });
    },

    count: ({
      where,
    }: {
      where: { testId: string; studentId?: string; status?: { not: AttemptStatus } };
    }) =>
      Promise.resolve(
        this.attemptRows.filter(
          (row) =>
            row.testId === where.testId &&
            (where.studentId === undefined || row.studentId === where.studentId) &&
            where.status?.not !== row.status,
        ).length + this.attempts.filter((row) => row.testId === where.testId).length,
      ),

    findFirst: ({
      where,
    }: {
      where: { id?: string; testId?: string; studentId: string; status?: AttemptStatus };
    }) => {
      const found = this.attemptRows
        .filter(
          (row) =>
            (where.id === undefined || row.id === where.id) &&
            (where.testId === undefined || row.testId === where.testId) &&
            row.studentId === where.studentId &&
            (where.status === undefined || row.status === where.status),
        )
        .sort((a, b) => b.attemptNo - a.attemptNo);
      return Promise.resolve(found[0] ? this.hydrateAttempt(found[0]) : null);
    },

    /** The unique on (testId, studentId, attemptNo) is what makes two racing starts one sitting. */
    create: ({
      data,
    }: {
      data: Partial<FakeAttemptRow> & { testId: string; studentId: string };
    }) => {
      const clash = this.attemptRows.some(
        (row) =>
          row.testId === data.testId &&
          row.studentId === data.studentId &&
          row.attemptNo === (data.attemptNo ?? 1),
      );
      if (clash) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'fake',
        });
      }
      this.attemptSeq += 1;
      const created = makeAttempt({ ...data, id: `att_new_${this.attemptSeq}` });
      this.attemptRows.push(created);
      return Promise.resolve(created);
    },
  };

  readonly testSeries = {
    findMany: ({ where }: { where: { id: { in: string[] } } }) =>
      Promise.resolve(this.series.filter((row) => where.id.in.includes(row.id))),

    findUnique: ({ where }: { where: { id: string } }) =>
      Promise.resolve(this.series.find((row) => row.id === where.id) ?? null),
  };

  private seriesNameOf(testSeriesId: string): string {
    return this.series.find((row) => row.id === testSeriesId)?.name ?? '';
  }

  readonly question = {
    findMany: ({ where = {} }: { where?: DrawPoolWhere; select?: unknown } = {}) =>
      Promise.resolve(this.questions.filter((row) => matchesPoolWhere(row, where))),

    findUnique: ({ where }: { where: { id: string } }) =>
      Promise.resolve(this.questions.find((row) => row.id === where.id) ?? null),

    updateMany: ({
      where,
      data,
    }: {
      where: { id: { in: string[] }; fixedUseCount?: { gt: number } };
      data: { fixedUseCount: { increment?: number; decrement?: number } };
    }) => {
      const floor = where.fixedUseCount?.gt;
      const matched = this.questions.filter(
        (row) => where.id.in.includes(row.id) && (floor === undefined || row.fixedUseCount > floor),
      );
      const by = (data.fixedUseCount.increment ?? 0) - (data.fixedUseCount.decrement ?? 0);
      for (const row of matched) row.fixedUseCount += by;
      return Promise.resolve({ count: matched.length });
    },
  };

  readonly paperQuestion = {
    findMany: ({ where }: { where: { testId: string; variant?: number } }) =>
      Promise.resolve(
        this.paperQuestions
          .filter(
            (row) =>
              row.testId === where.testId &&
              (where.variant === undefined || row.variant === where.variant),
          )
          .sort((a, b) => a.order - b.order)
          .map((row) => ({ ...row, question: this.questionRef(row.questionId) })),
      ),

    deleteMany: ({ where }: { where: { testId: string } }) => {
      const kept = this.paperQuestions.filter((row) => row.testId !== where.testId);
      const removed = this.paperQuestions.length - kept.length;
      this.paperQuestions.length = 0;
      this.paperQuestions.push(...kept);
      return Promise.resolve({ count: removed });
    },

    createMany: ({
      data,
    }: {
      data: (Omit<FakePaperRow, 'id' | 'status' | 'variant'> & { variant?: number })[];
    }) => {
      for (const row of data) {
        const variant = row.variant ?? 0;
        // The id carries the variant, or two variants' first questions would be the same row.
        this.paperQuestions.push({
          ...row,
          variant,
          id: `pq_${row.testId}_${variant}_${row.order}`,
          status: 'ACTIVE',
        });
      }
      return Promise.resolve({ count: data.length });
    },

    create: ({ data }: { data: Omit<FakePaperRow, 'id' | 'status' | 'variant'> }) => {
      const created: FakePaperRow = {
        ...data,
        variant: 0,
        id: `pq_${data.testId}_0_${data.order}`,
        status: 'ACTIVE',
      };
      this.paperQuestions.push(created);
      return Promise.resolve(created);
    },

    findUnique: ({ where }: { where: { id: string } }) =>
      Promise.resolve(this.paperQuestions.find((row) => row.id === where.id) ?? null),

    findFirst: ({
      where,
    }: {
      where: { testId: string; questionId: string; id?: { not: string } };
    }) =>
      Promise.resolve(
        this.paperQuestions.find(
          (row) =>
            row.testId === where.testId &&
            row.questionId === where.questionId &&
            row.id !== where.id?.not,
        ) ?? null,
      ),

    update: ({ where, data }: { where: { id: string }; data: Partial<FakePaperRow> }) => {
      const row = this.paperQuestions.find((candidate) => candidate.id === where.id);
      if (!row) throw new Error(`no paper row ${where.id}`);
      Object.assign(row, data);
      return Promise.resolve({ ...row });
    },

    /** Every variant carrying one question, gated on the status it is NOT already in. */
    updateMany: ({
      where,
      data,
    }: {
      where: { testId: string; questionId: string; status: { not: PaperQuestionStatus } };
      data: { status: PaperQuestionStatus };
    }) => {
      const matched = this.paperQuestions.filter(
        (row) =>
          row.testId === where.testId &&
          row.questionId === where.questionId &&
          row.status !== where.status.not,
      );
      for (const row of matched) Object.assign(row, data);
      return Promise.resolve({ count: matched.length });
    },

    delete: ({ where }: { where: { id: string } }) => {
      const index = this.paperQuestions.findIndex((row) => row.id === where.id);
      const [removed] = this.paperQuestions.splice(index, 1);
      return Promise.resolve(removed);
    },
  };

  /** The attempt as the paper service reads it: its test's config, its sections, its questions. */
  private hydrateAttempt(row: FakeAttemptRow) {
    const test = this.tests.find((candidate) => candidate.id === row.testId);
    const config = this.configs.find((candidate) => candidate.id === test?.baseConfigId);
    return {
      ...row,
      test: {
        examTemplate: test?.examTemplate ?? EXAM_TEMPLATE.DEFAULT,
        baseConfig: {
          languageMode: config?.languageMode ?? LANGUAGE_MODE.SINGLE,
          timerTemplate: config?.timerTemplate ?? TIMER_TEMPLATE.COMPOSITE_FREE,
          navigation: config?.navigation ?? NAVIGATION_POLICY.FREE,
          calculatorEnabled: config?.calculatorEnabled ?? false,
          shuffleOptions: config?.shuffleOptions ?? false,
          sections: this.sections
            .filter((section) => section.baseConfigId === config?.id)
            .sort((a, b) => a.order - b.order),
        },
      },
      questions: this.attemptQuestions
        .filter((served) => served.attemptId === row.id)
        .sort((a, b) => a.order - b.order)
        .map((served) => {
          const question = this.questions.find((candidate) => candidate.id === served.questionId);
          const version = this.questionVersions.find(
            (candidate) => candidate.id === served.questionVersionId,
          );
          const paper = this.paperQuestions.find(
            (candidate) => candidate.id === served.paperQuestionId,
          );
          return {
            questionId: served.questionId,
            order: served.order,
            baseConfigSectionId: served.baseConfigSectionId,
            question: { type: question?.type ?? 'SINGLE_MCQ' },
            questionVersion: {
              content: version?.content ?? null,
              options: version?.options ?? null,
            },
            paperItem: paper ? { marks: paper.marks, negativeMarks: paper.negativeMarks } : null,
          };
        }),
    };
  }

  private questionRef(questionId: string) {
    const question = this.questions.find((row) => row.id === questionId);
    return {
      id: questionId,
      questionCode: question?.questionCode ?? null,
      difficulty: question?.difficulty ?? 'MEDIUM',
      subjectId: question?.subjectId ?? '',
      topicId: question?.topicId ?? null,
    };
  }

  readonly test = {
    findUnique: ({ where }: { where: { id: string } }) => {
      const row = this.tests.find((test) => test.id === where.id);
      return Promise.resolve(row ? this.hydrateTest(row) : null);
    },

    findMany: ({
      where = {},
      skip = 0,
      take,
    }: {
      where?: {
        baseConfigId?: string;
        examStageId?: string;
        testSeriesId?: string;
        status?: { in: TestStatus[] };
      };
      skip?: number;
      take?: number;
    } = {}) => {
      const matched = this.tests.filter(
        (test) =>
          (where.baseConfigId === undefined || test.baseConfigId === where.baseConfigId) &&
          (where.examStageId === undefined || test.examStageId === where.examStageId) &&
          (where.testSeriesId === undefined || test.testSeriesId === where.testSeriesId) &&
          (where.status === undefined || where.status.in.includes(test.status)),
      );
      return Promise.resolve(
        matched
          .slice(skip, take === undefined ? undefined : skip + take)
          .map((test) => this.hydrateTest(test)),
      );
    },

    count: () => Promise.resolve(this.tests.length),

    create: ({ data }: { data: Partial<FakeTestModelRow> & { baseConfigId: string } }) => {
      this.testSeq += 1;
      const created = makeTest({
        ...data,
        ...jsonColumns(data),
        id: `tst_new_${this.testSeq}`,
      });
      this.tests.push(created);
      return Promise.resolve(this.hydrateTest(created));
    },

    update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const test = this.tests.find((candidate) => candidate.id === where.id);
      if (!test) throw new Error(`no test ${where.id}`);
      Object.assign(test, data, jsonColumns(data));
      return Promise.resolve(this.hydrateTest(test));
    },

    /** The conditional UPDATE finalize races on: it matches, or it does not and writes nothing. */
    updateMany: ({
      where,
      data,
    }: {
      where: { id: string; version?: number; isLocked?: boolean };
      data: {
        isLocked?: boolean;
        finalizedAt?: Date;
        status?: TestStatus;
        version?: { increment: number };
      };
    }) => {
      const matched = this.tests.filter(
        (test) =>
          test.id === where.id &&
          (where.version === undefined || test.version === where.version) &&
          (where.isLocked === undefined || test.isLocked === where.isLocked),
      );
      for (const test of matched) {
        if (data.isLocked !== undefined) test.isLocked = data.isLocked;
        if (data.finalizedAt !== undefined) test.finalizedAt = data.finalizedAt;
        if (data.status !== undefined) test.status = data.status;
        if (data.version) test.version += data.version.increment;
      }
      return Promise.resolve({ count: matched.length });
    },

    delete: ({ where }: { where: { id: string } }) => {
      const index = this.tests.findIndex((test) => test.id === where.id);
      const [removed] = this.tests.splice(index, 1);
      return Promise.resolve(removed);
    },
  };

  private hydrateTest(row: FakeTestModelRow) {
    const config = this.configs.find((candidate) => candidate.id === row.baseConfigId);
    const stage = this.stages.find((candidate) => candidate.id === row.examStageId);
    const exam = this.exams.find((candidate) => candidate.id === stage?.examId);
    return {
      ...row,
      _count: {
        attempts: this.attempts.filter((attempt) => attempt.testId === row.id).length,
        paperQuestions: this.paperQuestions.filter((paper) => paper.testId === row.id).length,
      },
      testSeries: row.testSeriesId === null ? null : { name: this.seriesNameOf(row.testSeriesId) },
      baseConfig: {
        name: config?.name ?? '',
        totalQuestions: config?.totalQuestions ?? 0,
        durationSec: config?.durationSec ?? 0,
        languageMode: config?.languageMode ?? LANGUAGE_MODE.SINGLE,
        languages: config?.languages ?? [],
        locked: config?.locked ?? false,
        // Selected with the test now, because a scoped test counts its own sections, not the config's.
        sections: this.sections
          .filter((section) => section.baseConfigId === config?.id)
          .sort((a, b) => a.order - b.order),
      },
      paperQuestions: this.paperQuestions
        .filter((paper) => paper.testId === row.id)
        .sort((a, b) => a.order - b.order),
      programUnlocks: [],
      examStage: {
        id: stage?.id ?? row.examStageId,
        stageKey: stage?.stageKey ?? '',
        name: stage?.name ?? '',
        exam: exam
          ? { id: exam.id, code: exam.code, name: exam.name, course: exam.course }
          : { id: '', code: '', name: '', course: EXAM_COURSE.SSC },
      },
    };
  }
}

interface DrawPoolWhere {
  id?: { in: string[] };
  status?: string;
  currentVersionId?: { not: null };
  subjectId?: { in: string[] };
  topicId?: { in: string[] };
  difficulty?: { in: string[] };
  tags?: { hasSome: string[] };
}

/** The `where` the draw's pool query builds, evaluated by the columns it constrains. */
function matchesPoolWhere(row: FakeQuestionRow, where: DrawPoolWhere): boolean {
  if (where.id && !where.id.in.includes(row.id)) return false;
  if (where.status !== undefined && row.status !== where.status) return false;
  if (where.currentVersionId && row.currentVersionId === null) return false;
  if (where.subjectId && !where.subjectId.in.includes(row.subjectId)) return false;
  if (where.topicId && (row.topicId === null || !where.topicId.in.includes(row.topicId)))
    return false;
  if (where.difficulty && !where.difficulty.in.includes(row.difficulty)) return false;
  if (where.tags && !where.tags.hasSome.some((tag) => row.tags.includes(tag))) return false;
  return true;
}

/** `Prisma.DbNull` is how the service says "clear it"; the row just holds null. */
function jsonColumns(data: Record<string, unknown>) {
  const cleared = (key: 'scopeRef' | 'questionPoolFilter') =>
    data[key] === Prisma.DbNull ? { [key]: null } : {};
  return { ...cleared('scopeRef'), ...cleared('questionPoolFilter') };
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

/** The admins facade as auth sees it: the grant map and the branches a token carries. */
export class FakeAdminsService {
  readonly calls: string[] = [];
  constructor(
    private readonly grants: Record<string, AdminPermissions> = {},
    private readonly branches: Record<string, string[]> = {},
  ) {}

  permissionsFor(adminId: string): Promise<AdminPermissions> {
    this.calls.push(adminId);
    return Promise.resolve(this.grants[adminId] ?? {});
  }

  branchIdsFor(adminId: string): Promise<string[]> {
    this.calls.push(adminId);
    return Promise.resolve(this.branches[adminId] ?? []);
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

  /** The join the scope is read off, so the query feeding it is exercised rather than stubbed. */
  readonly adminBranch = {
    findMany: ({ where }: { where: { adminId: string } }) =>
      Promise.resolve(this.admins.find((row) => row.id === where.adminId)?.branches ?? []),
  };

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
  fixedUseCount: number;
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
    fixedUseCount: 0,
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
  /** What an optimistic claim pins itself to: the row as the caller last read it. */
  updatedAt?: Date;
  /** The authoring scope: an author reaches their own rows and no others. */
  createdById?: string;
  createdAt?: { gte?: Date; lte?: Date };
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

/** Prisma moves `@updatedAt` on every write, and an optimistic claim pins itself to exactly that. */
let writes = 0;
const touched = () => {
  writes += 1;
  return { updatedAt: new Date(FIXED_NOW.getTime() + writes) };
};

const copyOf = (row: FakeQuestionVersionRow | undefined): FakeQuestionVersionRow | null =>
  row ? { ...row } : null;

/** A reference is looked up by one question or by a batch of them, and sometimes by version too. */
interface FakeRefWhere {
  questionId: string | { in: string[] };
  questionVersionId?: string;
}

const wants = (id: string, filter: FakeRefWhere['questionId']): boolean =>
  typeof filter === 'string' ? id === filter : filter.in.includes(id);

const countRefs = (
  rows: { questionId: string; questionVersionId?: string }[],
  where: FakeRefWhere,
) =>
  rows.filter(
    (row) =>
      wants(row.questionId, where.questionId) &&
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

  /** The search pre-filter, modelled rather than waved through: the ILIKE is the thing under test. */
  $queryRaw(_sql: TemplateStringsArray, ...values: unknown[]): Promise<{ id: string }[]> {
    const [pattern] = values;
    const term = (typeof pattern === 'string' ? pattern : '').replace(/^%|%$/g, '').toLowerCase();

    const holds = (row: FakeQuestionRow): boolean => {
      const version = this.versions.find((candidate) => candidate.id === row.currentVersionId);
      const content = version ? JSON.stringify(version.content) : '';
      return (
        content.toLowerCase().includes(term) ||
        (row.questionCode ?? '').toLowerCase().includes(term)
      );
    };

    return Promise.resolve(this.questions.filter(holds).map((row) => ({ id: row.id })));
  }

  readonly question = {
    findUniqueOrThrow: ({ where }: { where: { id: string } }) => {
      const row = this.questions.find((question) => question.id === where.id);
      if (!row) throw new Error(`no question ${where.id}`);
      return Promise.resolve(this.hydrate(row));
    },

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
      Object.assign(row, rest, touched());
      if (subject) row.subjectId = subjectIdOf(data);
      if (topic !== undefined) row.topicId = relationIdOf(data, 'topic');
      return Promise.resolve(this.hydrate(row));
    },

    delete: ({ where }: { where: { id: string } }) => {
      const index = this.questions.findIndex((question) => question.id === where.id);
      if (index === -1) throw new Error(`no question ${where.id}`);
      const [row] = this.questions.splice(index, 1);
      return Promise.resolve(rowAt([row]));
    },

    groupBy: ({ by, where }: { by: ['status']; where?: FakeQuestionWhere }) => {
      const counts = new Map<string, number>();
      for (const row of this.matching(where)) {
        const key = String(row[by[0]]);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return Promise.resolve([...counts].map(([status, _count]) => ({ status, _count })));
    },

    /** The same matcher `findMany` uses: a conditional write is a where, not just a list of ids. */
    updateMany: ({ where, data }: { where?: FakeQuestionWhere; data: Record<string, unknown> }) => {
      const rows = this.matching(where);
      for (const row of rows) Object.assign(row, data, touched());
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
    count: ({ where }: { where: FakeRefWhere }) =>
      Promise.resolve(countRefs(this.paperRefs, where)),
  };

  readonly attemptQuestion = {
    count: ({ where }: { where: FakeRefWhere }) =>
      Promise.resolve(countRefs(this.attemptRefs, where)),
  };

  /** Keyed on the question alone, so it outlives a version and blocks a delete of its own. */
  readonly testQuestionStat = {
    count: ({ where }: { where: FakeRefWhere }) => Promise.resolve(countRefs(this.statRefs, where)),
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
      _count: {
        paperQuestions: countRefs(this.paperRefs, { questionId: row.id }),
        attemptItems: countRefs(this.attemptRefs, { questionId: row.id }),
        questionStats: countRefs(this.statRefs, { questionId: row.id }),
      },
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
  'createdById',
  'createdAt',
  'subjectId',
  'topicId',
  'type',
  'difficulty',
  'status',
  'stemHash',
  'tags',
  'currentVersion',
  'updatedAt',
] as const;

function matches(row: FakeQuestionRow, where: FakeQuestionWhere | undefined): boolean {
  if (!where) return true;
  return matchesTree(where, (clause) => {
    onlyUnderstands(clause, QUESTION_WHERE_KEYS, 'The question fake');
    return (
      idMatches(row, clause.id) &&
      stemHashMatches(row, clause.stemHash) &&
      (clause.createdById === undefined || row.createdById === clause.createdById) &&
      writtenWithin(row, clause.createdAt) &&
      (clause.updatedAt === undefined || row.updatedAt.getTime() === clause.updatedAt.getTime()) &&
      QUESTION_FIELD_CHECKS.every((check) => check(row, clause))
    );
  });
}

function writtenWithin(row: FakeQuestionRow, range: FakeQuestionWhere['createdAt']): boolean {
  if (!range) return true;
  if (range.gte && row.createdAt < range.gte) return false;
  return !(range.lte && row.createdAt > range.lte);
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
  kind: TestSeriesKind;
  eventId: string | null;
  branchIds: string[];
  isEnabled: boolean;
  createdAt: Date;
  _count: { tests: number };
}

export interface FakeGrantRowAccess {
  studentId: string;
  testSeriesId: string;
  createdById: string | null;
  createdAt: Date;
}

/** What the series-delete guard reads: the RESTRICT column, and the join rows beside it. */
export interface FakeAccessTestRow {
  id: string;
  testSeriesId: string | null;
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
    kind: TEST_SERIES_KIND.STANDARD,
    eventId: null,
    branchIds: [],
    isEnabled: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
    _count: { tests: overrides._count?.tests ?? 0 },
  };
}

/** Enough Prisma for the access services: the catalog, the series and its branches. */
export class FakeAccessPrisma {
  private seq = 0;

  constructor(
    readonly programs: FakeProgramRow[] = [],
    readonly series: FakeSeriesRow[] = [],
    readonly branches: FakeBranch[] = [],
    readonly students: FakeStudent[] = [],
    readonly grants: FakeGrantRowAccess[] = [],
    readonly examStages: FakeExamStage[] = [makeExamStage()],
    readonly tests: FakeAccessTestRow[] = [],
  ) {}

  readonly test = {
    count: ({ where }: { where: { testSeriesId: string } }) =>
      Promise.resolve(this.tests.filter((row) => row.testSeriesId === where.testSeriesId).length),
  };

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
    // A fake with no soft-deleted rows answers `deletedAt: null` the same either way.
    findMany: ({ where = {} }: { where?: { deletedAt?: null; id?: { in: string[] } } } = {}) =>
      Promise.resolve(
        this.branches
          .filter((branch) => !where.id || where.id.in.includes(branch.id))
          .map((branch) => ({ id: branch.id, name: branch.name }))
          .sort((left, right) => left.name.localeCompare(right.name)),
      ),

    /** The existence check the branch-side reads make before they answer for one. */
    findFirst: ({ where }: { where: { id: string; deletedAt?: null } }) => {
      const branch = this.branches.find((candidate) => candidate.id === where.id);
      return Promise.resolve(branch ? { id: branch.id, name: branch.name } : null);
    },

    count: ({ where = {} }: { where?: { deletedAt?: null; id?: { in: string[] } } } = {}) =>
      Promise.resolve(
        this.branches.filter((branch) => !where.id || where.id.in.includes(branch.id)).length,
      ),
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

    findMany: ({
      where = {},
      skip = 0,
      take,
    }: {
      where?: FakeSeriesWhere;
      skip?: number;
      take?: number;
    } = {}) =>
      Promise.resolve(
        this.series
          .filter((row) => matchesSeries(row, where))
          // By name, as every paged read of this table asks for; the fixtures rely on it.
          .sort(
            (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
          )
          .slice(skip, take === undefined ? undefined : skip + take)
          .map((row) => this.hydrate(row)),
      ),

    // The same `where` the rows came off, or a pager promises pages nobody can open.
    count: ({ where = {} }: { where?: FakeSeriesWhere } = {}) =>
      Promise.resolve(this.series.filter((row) => matchesSeries(row, where)).length),

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
      // `Test.testSeriesId` is ON DELETE RESTRICT, and Prisma's P2003 for it can only leave as a 500.
      if (this.tests.some((row) => row.testSeriesId === where.id)) {
        throw new Error(`Test_testSeriesId_fkey restricts deleting ${where.id}`);
      }
      const index = this.series.findIndex((row) => row.id === where.id);
      const [removed] = this.series.splice(index, 1);
      return Promise.resolve(removed);
    },
  };

  readonly student = {
    findUnique: ({ where }: { where: { id: string } }) => {
      const row = this.students.find((student) => student.id === where.id);
      return Promise.resolve(row ? { ...row } : null);
    },

    /** The scoped read: a branch filter, and `in: []` matching nobody exactly as Prisma does. */
    findFirst: ({
      where,
    }: {
      where: { id: string; deletedAt?: null; currentBranchId?: { in: string[] } };
    }) => {
      const row = this.students.find(
        (student) =>
          student.id === where.id &&
          (where.deletedAt === undefined || student.deletedAt === null) &&
          (where.currentBranchId === undefined ||
            (student.currentBranchId !== null &&
              where.currentBranchId.in.includes(student.currentBranchId))),
      );
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

    findMany: ({
      where,
    }: {
      where: { studentId?: string; testSeriesId?: string | { in: string[] } };
    }) =>
      Promise.resolve(
        this.grants
          .filter(
            (grant) =>
              (where.studentId === undefined || grant.studentId === where.studentId) &&
              matchesKey(grant.testSeriesId, where.testSeriesId),
          )
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

/** The series filters `FakeAccessPrisma` answers. */
interface FakeSeriesWhere {
  AND?: FakeSeriesWhere[];
  NOT?: FakeSeriesWhere;
  id?: { in: string[] };
  programCode?: string;
  kind?: TestSeriesKind;
  name?: { contains: string; mode?: string };
  examStageId?: { in: string[] };
}

function matchesSeries(row: FakeSeriesRow, where: FakeSeriesWhere): boolean {
  if (where.AND && !where.AND.every((part) => matchesSeries(row, part))) return false;
  if (where.NOT && matchesSeries(row, where.NOT)) return false;
  return matchesSeriesColumns(row, where);
}

/** The series' own columns, apart from the recursion and the join above. */
function matchesSeriesColumns(row: FakeSeriesRow, where: FakeSeriesWhere): boolean {
  if (where.id && !where.id.in.includes(row.id)) return false;
  if (where.programCode !== undefined && row.programCode !== where.programCode) return false;
  if (where.kind !== undefined && row.kind !== where.kind) return false;
  if (where.name && !row.name.toLowerCase().includes(where.name.contains.toLowerCase())) {
    return false;
  }
  return !where.examStageId || where.examStageId.in.includes(row.examStageId ?? '');
}

export interface FakeEventRow {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
}

export function makeEvent(overrides: Partial<FakeEventRow> = {}): FakeEventRow {
  return {
    id: 'evt_1',
    name: 'SSC CGL Scholarship Camp',
    description: null,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

export interface FakeEventCandidateRow {
  eventId: string;
  studentId: string;
  createdAt: Date;
}

interface FakeEventWhere {
  AND?: { OR: ({ name: { contains: string } } | { description: { contains: string } })[] }[];
  isActive?: boolean;
}

function matchesEvent(row: FakeEventRow, where: FakeEventWhere): boolean {
  if (where.isActive !== undefined && row.isActive !== where.isActive) return false;
  if (!where.AND) return true;
  return where.AND.every((clause) =>
    clause.OR.some((part) =>
      'name' in part
        ? row.name.toLowerCase().includes(part.name.contains.toLowerCase())
        : (row.description ?? '').toLowerCase().includes(part.description.contains.toLowerCase()),
    ),
  );
}

type FakeCandidateTerm =
  { student: { fullName: { contains: string } } } | { student: { mobile: { contains: string } } };

interface FakeEventCandidateWhere {
  eventId: string;
  studentId?: { in: string[] };
  AND?: { OR: FakeCandidateTerm[] }[];
}

function matchesCandidate(
  row: FakeEventCandidateRow,
  where: FakeEventCandidateWhere,
  studentOf: (studentId: string) => { fullName: string | null; mobile: string },
): boolean {
  if (row.eventId !== where.eventId) return false;
  if (where.studentId && !where.studentId.in.includes(row.studentId)) return false;
  if (!where.AND) return true;

  const student = studentOf(row.studentId);
  return where.AND.every((clause) =>
    clause.OR.some((part) =>
      'fullName' in part.student
        ? (student.fullName ?? '')
            .toLowerCase()
            .includes(part.student.fullName.contains.toLowerCase())
        : student.mobile.includes(part.student.mobile.contains),
    ),
  );
}

/** Enough Prisma for `EventsService`: the event table, its candidates, and the series count the delete guard reads. */
export class FakeEventsPrisma {
  private seq = 0;

  constructor(
    readonly events: FakeEventRow[] = [],
    readonly candidateRows: FakeEventCandidateRow[] = [],
    readonly students: FakeStudent[] = [],
    readonly seriesEventIds: string[] = [],
  ) {}

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_new_${this.seq}`;
  }

  asService(): PrismaService {
    return this as unknown as PrismaService;
  }

  $transaction<T>(work: Promise<T>[]): Promise<T[]> {
    return Promise.all(work);
  }

  private hydrate(row: FakeEventRow) {
    return {
      ...row,
      _count: {
        candidates: this.candidateRows.filter((c) => c.eventId === row.id).length,
        series: this.seriesEventIds.filter((id) => id === row.id).length,
      },
    };
  }

  private studentRef(studentId: string): { fullName: string | null; mobile: string } {
    const student = this.students.find((candidate) => candidate.id === studentId);
    return { fullName: student?.fullName ?? null, mobile: student?.mobile ?? '' };
  }

  readonly event = {
    findUnique: ({ where }: { where: { id: string } }) => {
      const row = this.events.find((event) => event.id === where.id);
      return Promise.resolve(row ? this.hydrate(row) : null);
    },

    findMany: ({
      where = {},
      skip = 0,
      take,
    }: { where?: FakeEventWhere; skip?: number; take?: number } = {}) => {
      const matched = this.events
        .filter((event) => matchesEvent(event, where))
        .sort((a, b) => a.name.localeCompare(b.name));
      return Promise.resolve(
        matched
          .slice(skip, take === undefined ? undefined : skip + take)
          .map((event) => this.hydrate(event)),
      );
    },

    count: ({ where = {} }: { where?: FakeEventWhere } = {}) =>
      Promise.resolve(this.events.filter((event) => matchesEvent(event, where)).length),

    create: ({ data }: { data: Partial<FakeEventRow> & { name: string } }) => {
      const created = makeEvent({ ...data, id: this.id('evt') });
      this.events.push(created);
      return Promise.resolve(this.hydrate(created));
    },

    update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const event = this.events.find((candidate) => candidate.id === where.id);
      if (!event) throw new Error(`no event ${where.id}`);
      Object.assign(event, data);
      return Promise.resolve(this.hydrate(event));
    },

    delete: ({ where }: { where: { id: string } }) => {
      const index = this.events.findIndex((event) => event.id === where.id);
      const [removed] = this.events.splice(index, 1);
      return Promise.resolve(removed);
    },
  };

  private rosterOf(where: FakeEventCandidateWhere): FakeEventCandidateRow[] {
    return this.candidateRows
      .filter((row) => matchesCandidate(row, where, (id) => this.studentRef(id)))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  readonly eventCandidate = {
    findMany: ({
      where,
      skip = 0,
      take,
    }: {
      where: FakeEventCandidateWhere;
      skip?: number;
      take?: number;
    }) =>
      Promise.resolve(
        this.rosterOf(where)
          .slice(skip, take === undefined ? undefined : skip + take)
          .map((row) => ({ ...row, student: this.studentRef(row.studentId) })),
      ),

    count: ({ where }: { where: FakeEventCandidateWhere }) =>
      Promise.resolve(this.rosterOf(where).length),

    createMany: ({
      data,
      skipDuplicates,
    }: {
      data: { eventId: string; studentId: string }[];
      skipDuplicates?: boolean;
    }) => {
      const fresh = skipDuplicates
        ? data.filter(
            (row) =>
              !this.candidateRows.some(
                (held) => held.eventId === row.eventId && held.studentId === row.studentId,
              ),
          )
        : data;
      for (const row of fresh) {
        this.candidateRows.push({ ...row, createdAt: new Date('2026-01-01T00:00:00.000Z') });
      }
      return Promise.resolve({ count: fresh.length });
    },

    deleteMany: ({ where }: { where: { eventId: string; studentId: string } }) => {
      const kept = this.candidateRows.filter(
        (row) => row.eventId !== where.eventId || row.studentId !== where.studentId,
      );
      const removed = this.candidateRows.length - kept.length;
      this.candidateRows.length = 0;
      this.candidateRows.push(...kept);
      return Promise.resolve({ count: removed });
    },
  };
}

/** The `Test` columns the catalog reads — its series, its own window — plus the config it joins in. */
export interface FakeTestRow {
  id: string;
  title: string | null;
  status: TestStatus;
  durationSec: number;
  totalQuestions: number;
  totalMarks: number;
  scope?: TestScope;
  scopeRef?: TestScopeRef | null;
  testSeriesId: string | null;
  seriesOrder: number | null;
  opensAt: Date | null;
  lateEntrySec: number | null;
  extraTimeSec: number | null;
}

export function makeTestRow(overrides: Partial<FakeTestRow> = {}): FakeTestRow {
  return {
    id: 'tst_1',
    title: 'Mock 1',
    status: TEST_STATUS.ACTIVE,
    durationSec: 3600,
    totalQuestions: 100,
    totalMarks: 200,
    testSeriesId: null,
    seriesOrder: null,
    opensAt: null,
    lateEntrySec: null,
    extraTimeSec: null,
    ...overrides,
  };
}

/** When one test opens for one program's cohort, ahead of the test's own opening. */
export interface FakeProgramUnlockRow {
  testId: string;
  programCode: string;
  opensAt: Date;
}

export interface FakeCatalogData {
  students?: FakeStudent[];
  series?: FakeSeriesRow[];
  grants?: FakeGrantRowAccess[];
  /** Who an EVENT series reaches: the people named on its event. */
  eventCandidates?: { eventId: string; studentId: string }[];
  programUnlocks?: FakeProgramUnlockRow[];
  /** What the student has already sat — what a series unlocking in order reads. */
  attempts?: { studentId: string; testId: string; status: string }[];
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
  kind?: TestSeriesKind;
  branchIds?: { has: string };
  event?: { candidates: { some: { studentId: string } } };
  examStage?: { exam: { course?: { in: ExamCourse[] } } };
}

interface CatalogSeriesWhere extends CatalogReachWhere {
  isEnabled?: boolean;
  id?: { in: string[] };
  OR?: CatalogSeriesWhere[];
  NOT?: CatalogSeriesWhere;
}

interface CatalogInclude {
  tests: {
    where: { status: TestStatus };
    select: { programUnlocks: { where: { programCode: { in: string[] } } } };
  };
}

type CatalogSortField = 'name' | 'id';
type CatalogOrderBy = Partial<Record<CatalogSortField, 'asc' | 'desc'>>;

/** Every Prisma method that changes a row, by the verb its name carries. */
const WRITE_OPERATIONS = ['create', 'update', 'upsert', 'delete'] as const;

/**
 * Enough Prisma for the access resolver, and no more. It evaluates the `where` it is HANDED
 * rather than knowing anything about reach, so a truth-table test really exercises the
 * predicates the resolver builds.
 */
export class FakeCatalogPrisma {
  /** Every read that reached "Postgres" — what the cache tests count. */
  readonly queries: string[] = [];

  /** The subset of `queries` that would have changed a row — a catalog read must leave this empty. */
  readonly writes: string[] = [];

  /** Runs as each read reaches "Postgres", so a test can interleave a bust with a resolve. */
  onQuery: ((name: string) => Promise<void>) | null = null;

  private readonly data: Required<FakeCatalogData>;

  constructor(data: FakeCatalogData = {}) {
    this.data = {
      students: data.students ?? [],
      series: data.series ?? [],
      grants: data.grants ?? [],
      eventCandidates: data.eventCandidates ?? [],
      programUnlocks: data.programUnlocks ?? [],
      attempts: data.attempts ?? [],
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

  readonly attempt = {
    findMany: async ({
      where,
    }: {
      where: { studentId: string; testId?: { in: string[] }; status?: { in: string[] } };
    }) => {
      await this.record('attempt.findMany');
      return this.data.attempts.filter(
        (row) =>
          row.studentId === where.studentId &&
          (where.testId === undefined || where.testId.in.includes(row.testId)) &&
          (where.status === undefined || where.status.in.includes(row.status)),
      );
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
      // The stage rides along: serving a `select` for it is cheaper than detecting one.
      return include
        ? rows.map((row) => this.hydrate(row, include))
        : rows.map((row) => ({ ...row, examStage: this.stageOf(row.examStageId) }));
    },

    findUnique: async ({ where }: { where: { id: string } }) => {
      await this.record('testSeries.findUnique');
      const row = this.data.series.find((candidate) => candidate.id === where.id);
      return row ? { ...row, examStage: this.stageOf(row.examStageId) } : null;
    },
  };

  readonly test = {
    findUnique: async ({ where }: { where: { id: string } }) => {
      await this.record('test.findUnique');
      const row = this.data.tests.find((test) => test.id === where.id);
      return row ? { ...row } : null;
    },
  };

  $transaction<T>(work: Promise<T>[]): Promise<T[]> {
    return Promise.all(work);
  }

  private async record(name: string): Promise<void> {
    this.queries.push(name);
    if (WRITE_OPERATIONS.some((verb) => name.includes(verb))) this.writes.push(name);
    await this.onQuery?.(name);
  }

  private matchesSeries(row: FakeSeriesRow, where: CatalogSeriesWhere): boolean {
    return (
      (where.isEnabled === undefined || row.isEnabled === where.isEnabled) &&
      (where.id === undefined || where.id.in.includes(row.id)) &&
      (where.kind === undefined || row.kind === where.kind) &&
      (where.branchIds === undefined || row.branchIds.includes(where.branchIds.has)) &&
      this.matchesGrant(row, where.grants) &&
      this.matchesCandidacy(row, where.event) &&
      matchesProgramCode(row.programCode, where.programCode) &&
      this.matchesExam(row, where.examStage) &&
      (where.OR === undefined || where.OR.some((clause) => this.matchesSeries(row, clause))) &&
      (where.NOT === undefined || !this.matchesSeries(row, where.NOT))
    );
  }

  private matchesCandidacy(row: FakeSeriesRow, filter: CatalogReachWhere['event']): boolean {
    if (filter === undefined) return true;
    return this.data.eventCandidates.some(
      (candidate) =>
        candidate.eventId === row.eventId &&
        candidate.studentId === filter.candidates.some.studentId,
    );
  }

  private matchesGrant(row: FakeSeriesRow, filter: CatalogReachWhere['grants']): boolean {
    if (filter === undefined) return true;
    return this.data.grants.some(
      (grant) => grant.testSeriesId === row.id && grant.studentId === filter.some.studentId,
    );
  }

  private matchesExam(row: FakeSeriesRow, filter: CatalogReachWhere['examStage']): boolean {
    if (filter?.exam.course === undefined) return true;
    const course = this.examCourseOf(row.examStageId);
    return course !== null && filter.exam.course.in.includes(course);
  }

  /** The shape a `select: { examStage: { exam: ... } }` expects back. */
  private stageOf(examStageId: string | null) {
    const course = this.examCourseOf(examStageId);
    const code = this.examCodeOf(examStageId);
    return course === null && code === null ? null : { exam: { course, code } };
  }

  private examCourseOf(examStageId: string | null): ExamCourse | null {
    const stage = this.data.stages.find((candidate) => candidate.id === examStageId);
    const exam = this.data.exams.find((candidate) => candidate.id === stage?.examId);
    return exam?.course ?? null;
  }

  private examCodeOf(examStageId: string | null): string | null {
    const stage = this.data.stages.find((candidate) => candidate.id === examStageId);
    const exam = this.data.exams.find((candidate) => candidate.id === stage?.examId);
    return exam?.code ?? null;
  }

  private hydrate(row: FakeSeriesRow, include: CatalogInclude) {
    const stage = this.data.stages.find((candidate) => candidate.id === row.examStageId);
    const code = this.examCodeOf(row.examStageId);
    const programs = include.tests.select.programUnlocks.where.programCode.in;

    return {
      ...row,
      examStage: stage && code !== null ? { id: stage.id, name: stage.name, exam: { code } } : null,
      tests: this.data.tests
        .filter(
          (test) => test.testSeriesId === row.id && test.status === include.tests.where.status,
        )
        .map((test) => ({
          id: test.id,
          title: test.title,
          seriesOrder: test.seriesOrder,
          opensAt: test.opensAt,
          lateEntrySec: test.lateEntrySec,
          extraTimeSec: test.extraTimeSec,
          scope: test.scope ?? TEST_SCOPE.FULL,
          scopeRef: test.scopeRef ?? null,
          baseConfig: {
            durationSec: test.durationSec,
            totalQuestions: test.totalQuestions,
            totalMarks: new Prisma.Decimal(test.totalMarks),
            // One section standing for the whole paper: the catalog now sums what the scope covers.
            sections: [
              {
                id: `${test.id}_sec`,
                moduleId: null,
                questionCount: test.totalQuestions,
                marksPerQuestion: new Prisma.Decimal(
                  test.totalQuestions === 0 ? 0 : test.totalMarks / test.totalQuestions,
                ),
              },
            ],
          },
          programUnlocks: this.data.programUnlocks
            .filter((unlock) => unlock.testId === test.id && programs.includes(unlock.programCode))
            .map((unlock) => ({ opensAt: unlock.opensAt })),
        })),
    };
  }
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

  constructor(
    readonly rows: FakeNotificationRow[] = [],
    private readonly mobiles: Record<string, string> = {},
  ) {}

  /** Only what `mobileOf` asks for: a live student's number, or nothing. */
  readonly student = {
    findFirst: ({ where }: { where: { id: string } }) =>
      Promise.resolve(this.mobiles[where.id] ? { mobile: this.mobiles[where.id] } : null),
  };

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

// --------------------------------------------------------------------------- scoring
// ---------------------------------------------------------------------------

export interface FakeServedAnswerRow {
  attemptId: string;
  questionId: string;
  paperQuestionId: string | null;
  baseConfigSectionId: string;
  subjectId: string;
  subjectName: string;
  difficulty: DifficultyLevel;
  order: number;
  type: QuestionType;
  selectedOptionId: string | null;
  typedAnswer: string | null;
  state: AnswerState;
  timeSpentSec: number;
  content: unknown;
  options: unknown;
  answerKey: unknown;
  paperItem: { marks: number; negativeMarks: number; status: PaperQuestionStatus } | null;
  isCorrect: boolean | null;
  marksAwarded: number | null;
}

/** Four options at `o1`..`o4`, one of them right — the shape a version's `options` column holds. */
export function mcqOptions(correctPosition: number, count = 4): unknown {
  return Array.from({ length: count }, (_, index) => ({
    id: `o${index + 1}`,
    position: index + 1,
    isCorrect: index + 1 === correctPosition,
    text: { en: [{ type: 'TEXT', text: `Option ${index + 1}` }] },
  }));
}

export function makeServedAnswer(
  overrides: Partial<FakeServedAnswerRow> = {},
): FakeServedAnswerRow {
  return {
    attemptId: 'att_1',
    questionId: 'q_1',
    paperQuestionId: null,
    baseConfigSectionId: 'sec_1',
    subjectId: 'sub_1',
    subjectName: 'Reasoning',
    difficulty: DIFFICULTY_LEVEL.MEDIUM,
    order: 1,
    type: QUESTION_TYPE.SINGLE_MCQ,
    selectedOptionId: null,
    typedAnswer: null,
    state: ANSWER_STATE.NOT_VISITED,
    timeSpentSec: 0,
    content: null,
    options: mcqOptions(1),
    answerKey: null,
    paperItem: { marks: 2, negativeMarks: 0.5, status: PAPER_QUESTION_STATUS.ACTIVE },
    isCorrect: null,
    marksAwarded: null,
    ...overrides,
  };
}

/** The blueprint a scored sitting is read back against — the shape, not this student's marks. */
export interface FakeScoredTest {
  title: string | null;
  evaluationMode: EvaluationMode;
  shuffleOptions: boolean;
  durationSec: number;
  totalQuestions: number;
  totalMarks: number;
  sections: {
    id: string;
    name: string;
    order: number;
    questionCount: number;
    marksPerQuestion: number;
    durationSec: number | null;
  }[];
}

export function makeScoredTest(overrides: Partial<FakeScoredTest> = {}): FakeScoredTest {
  return {
    title: 'SSC CGL Tier 1 — Mock 1',
    evaluationMode: EVALUATION_MODE.RANKED,
    shuffleOptions: false,
    durationSec: 3600,
    totalQuestions: 3,
    totalMarks: 6,
    sections: [
      {
        id: 'sec_1',
        name: 'Section A',
        order: 1,
        questionCount: 3,
        marksPerQuestion: 2,
        durationSec: null,
      },
    ],
    ...overrides,
  };
}

/** Only what the scorer touches: a sitting, its served rows, and the two writes it makes. */
export class FakeScoringPrisma {
  constructor(
    readonly attempts: FakeAttemptRow[] = [],
    readonly served: FakeServedAnswerRow[] = [],
    readonly shape: FakeScoredTest = makeScoredTest(),
  ) {}

  /** Deliberately hands over the WHOLE served row, key and all: excluding it is the code's job. */
  private reported(row: FakeAttemptRow) {
    return {
      ...row,
      test: {
        title: this.shape.title,
        evaluationMode: this.shape.evaluationMode,
        baseConfig: {
          durationSec: this.shape.durationSec,
          totalQuestions: this.shape.totalQuestions,
          totalMarks: this.shape.totalMarks,
          shuffleOptions: this.shape.shuffleOptions,
          sections: [...this.shape.sections].sort((a, b) => a.order - b.order),
        },
      },
      questions: this.served
        .filter((served) => served.attemptId === row.id)
        .sort((a, b) => a.order - b.order)
        .map((served) => ({
          ...served,
          question: {
            type: served.type,
            difficulty: served.difficulty,
            subject: { id: served.subjectId, name: served.subjectName },
          },
          questionVersion: {
            content: served.content,
            options: served.options,
            answerKey: served.answerKey,
          },
        })),
    };
  }

  /** How many times a caller has read one sitting — a refusal that reads twice has read the key. */
  reads = 0;

  readonly attempt = {
    findFirst: ({ where }: { where: { id: string; studentId: string } }) => {
      this.reads += 1;
      const row = this.attempts.find(
        (candidate) => candidate.id === where.id && candidate.studentId === where.studentId,
      );
      return Promise.resolve(row ? this.reported(row) : null);
    },

    findUnique: ({ where }: { where: { id: string } }) => {
      const row = this.attempts.find((candidate) => candidate.id === where.id);
      if (!row) return Promise.resolve(null);
      return Promise.resolve({
        ...row,
        questions: this.served
          .filter((served) => served.attemptId === row.id)
          .sort((a, b) => a.order - b.order)
          .map((served) => ({
            questionId: served.questionId,
            baseConfigSectionId: served.baseConfigSectionId,
            selectedOptionId: served.selectedOptionId,
            typedAnswer: served.typedAnswer,
            timeSpentSec: served.timeSpentSec,
            question: { type: served.type },
            questionVersion: { options: served.options, answerKey: served.answerKey },
            paperItem: served.paperItem,
          })),
      });
    },

    /** The rebuild's page, and the trend read — both are "the sittings that count", ordered. */
    findMany: ({
      where,
      orderBy,
      distinct,
      skip = 0,
      take,
    }: {
      where: {
        testId?: string;
        studentId?: string;
        isGraded?: boolean;
        status: AttemptStatus;
        score?: { not: null };
      };
      orderBy?: { submittedAt?: 'desc' };
      distinct?: string[];
      skip?: number;
      take?: number;
    }) => {
      const matched = this.attempts.filter(
        (row) =>
          (where.testId === undefined || row.testId === where.testId) &&
          (where.studentId === undefined || row.studentId === where.studentId) &&
          (where.isGraded === undefined || row.isGraded === where.isGraded) &&
          row.status === where.status &&
          (where.score === undefined || row.score !== null),
      );
      // Postgres sorts NULLS FIRST on a descending order; a fake that did not would hide it.
      const byNewest = (a: FakeAttemptRow, b: FakeAttemptRow) => {
        if (a.submittedAt === null || b.submittedAt === null) {
          return (a.submittedAt === null ? 0 : 1) - (b.submittedAt === null ? 0 : 1);
        }
        return b.submittedAt.getTime() - a.submittedAt.getTime();
      };
      const ordered = orderBy?.submittedAt
        ? matched.toSorted(byNewest)
        : matched.toSorted((a, b) => a.id.localeCompare(b.id));
      const paged = ordered.slice(skip, take === undefined ? undefined : skip + take);
      return Promise.resolve(
        distinct?.includes('testId') ? uniqueByTest(paged) : paged.map((row) => this.reported(row)),
      );
    },

    count: ({ where }: { where: { studentId?: string; status?: AttemptStatus } }) =>
      Promise.resolve(
        this.attempts.filter(
          (row) =>
            (where.studentId === undefined || row.studentId === where.studentId) &&
            (where.status === undefined || row.status === where.status),
        ).length,
      ),

    aggregate: ({
      where,
    }: {
      where: { testId: string; isGraded: boolean; status: AttemptStatus; score: { not: null } };
    }) => {
      const scored = this.attempts.filter(
        (row) =>
          row.testId === where.testId &&
          row.isGraded === where.isGraded &&
          row.status === where.status &&
          row.score !== null,
      );
      const marks = scored.map((row) => row.score ?? 0);
      return Promise.resolve({
        _avg: {
          score: marks.length === 0 ? null : marks.reduce((a, b) => a + b, 0) / marks.length,
        },
        _max: { score: marks.length === 0 ? null : Math.max(...marks) },
        _count: scored.length,
      });
    },

    update: ({ where, data }: { where: { id: string }; data: Partial<FakeAttemptRow> }) => {
      const row = this.attempts.find((candidate) => candidate.id === where.id);
      if (!row) throw new Error(`no attempt ${where.id}`);
      Object.assign(row, data);
      return Promise.resolve(row);
    },

    updateMany: ({
      where,
      data,
    }: {
      where: { id: string; evaluatedAt: null };
      data: { evaluatedAt: Date };
    }) => {
      const matched = this.attempts.filter(
        (row) => row.id === where.id && row.evaluatedAt === null,
      );
      for (const row of matched) Object.assign(row, data);
      return Promise.resolve({ count: matched.length });
    },
  };

  readonly attemptQuestion = {
    updateMany: ({
      where,
      data,
    }: {
      where: { attemptId: string; questionId: { in: string[] } };
      data: { isCorrect: boolean | null; marksAwarded: number };
    }) => {
      const matched = this.served.filter(
        (row) => row.attemptId === where.attemptId && where.questionId.in.includes(row.questionId),
      );
      for (const row of matched) Object.assign(row, data);
      return Promise.resolve({ count: matched.length });
    },
  };

  readonly outboxEvents: FakeOutboxRow[] = [];

  private outboxSeq = 0;

  readonly outboxEvent = {
    create: ({ data }: { data: FakeOutboxInput }) => {
      this.outboxSeq += 1;
      const created: FakeOutboxRow = {
        ...data,
        id: `obx_${this.outboxSeq}`,
        createdAt: new Date(this.outboxSeq),
        processedAt: null,
      };
      this.outboxEvents.push(created);
      return Promise.resolve({ id: created.id });
    },

    findMany: ({ where, take }: { where: FakeOutboxWhere; take?: number }) =>
      Promise.resolve(
        this.outboxEvents.filter((row) => matchesOutboxWhere(row, where)).slice(0, take),
      ),

    update: ({ where, data }: { where: { id: string }; data: { processedAt: Date } }) => {
      const row = this.outboxEvents.find((candidate) => candidate.id === where.id);
      if (!row) throw new Error(`no outbox row ${where.id}`);
      row.processedAt = data.processedAt;
      return Promise.resolve(row);
    },
  };

  /** Both forms: the scorer's persist is one callback, and the report's reads are a batch. */
  $transaction<T>(work: Promise<T>[] | ((tx: FakeScoringPrisma) => Promise<T>)): Promise<T[] | T> {
    return typeof work === 'function' ? work(this) : Promise.all(work);
  }

  asService(): PrismaService {
    return this as unknown as PrismaService;
  }
}

/** `distinct: ['testId']` returns one row per test, which is what "tests done" counts. */
function uniqueByTest(rows: readonly FakeAttemptRow[]): { testId: string }[] {
  const seen = new Set<string>();
  return rows
    .filter((row) => !seen.has(row.testId) && seen.add(row.testId) !== undefined)
    .map((row) => ({ testId: row.testId }));
}

/** The seam a paper edit asks for a re-score through. Nothing here exercises the scoring itself. */
export function fakeScoringOutbox(prisma: FakeTestsPrisma): ScoringOutbox {
  return new ScoringOutbox(prisma.asService(), new FakeQueue().asQueue());
}

/** The rollup rows the performance report reads, plus the catalog it resolves a scope through. */
export interface FakePerformanceData {
  attempts: FakeAttemptRow[];
  served: FakeServedAnswerRow[];
  shape: FakeScoredTest;
  students: { id: string; deletedAt: Date | null; currentBranchId?: string | null }[];
  series: { id: string; name: string; progressive?: boolean }[];
  /** Membership is the test's own column, so a rung is a test carrying the series' id. */
  tests: { id: string; testSeriesId: string; seriesOrder?: number | null }[];
  testStats: {
    testId: string;
    evaluatedCount: number;
    sumScore: number | Prisma.Decimal;
    maxScore: number | Prisma.Decimal | null;
    scoreHistogram: unknown;
    sumTimeSec?: number;
    topperAttemptId?: string | null;
  }[];
  sectionStats: {
    testId: string;
    baseConfigSectionId: string;
    attempted: number;
    sumScore: number;
    sumTimeSec: number;
  }[];
  questionStats: {
    testId: string;
    paperQuestionId: string;
    pValue: number | null;
    attemptedCount?: number;
    skippedCount?: number;
    correctCount?: number;
    sumTimeSec?: number;
    optionCounts?: unknown;
  }[];
}

/** Postgres sorts NULLs FIRST on a descending order unless the query asks for them last. */
function newestFirst(nullsLast: boolean) {
  const rankOf = (row: FakeAttemptRow) => {
    if (row.submittedAt !== null) return 0;
    return nullsLast ? 1 : -1;
  };
  return (a: FakeAttemptRow, b: FakeAttemptRow) =>
    rankOf(a) - rankOf(b) || (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0);
}

/** Hands over the WHOLE served row, answer key and all — leaving it out of a payload is the code's job. */
export class FakePerformancePrisma {
  constructor(private readonly data: FakePerformanceData) {}

  private reported(row: FakeAttemptRow) {
    return {
      ...row,
      test: {
        title: this.data.shape.title,
        evaluationMode: this.data.shape.evaluationMode,
        baseConfig: {
          durationSec: this.data.shape.durationSec,
          sections: [...this.data.shape.sections].sort((a, b) => a.order - b.order),
        },
      },
      questions: this.data.served
        .filter((served) => served.attemptId === row.id)
        .sort((a, b) => a.order - b.order)
        .map((served) => ({
          ...served,
          question: {
            type: served.type,
            difficulty: served.difficulty,
            subject: { id: served.subjectId, name: served.subjectName },
          },
          questionVersion: {
            content: served.content,
            options: served.options,
            answerKey: served.answerKey,
          },
        })),
    };
  }

  readonly attempt = {
    /** The topper, read for their clock: the whole row, because leaving fields out is the code's job. */
    findUnique: ({ where }: { where: { id: string } }) => {
      const row = this.data.attempts.find((held) => held.id === where.id);
      return Promise.resolve(row ? this.reported(row) : null);
    },

    findFirst: ({ where }: { where: { id: string; studentId: string } }) => {
      const row = this.data.attempts.find(
        (held) => held.id === where.id && held.studentId === where.studentId,
      );
      return Promise.resolve(row ? this.reported(row) : null);
    },

    findMany: ({
      where,
      orderBy,
      take,
    }: {
      where: {
        studentId: string;
        status: AttemptStatus;
        id?: string;
        testId?: string;
        test?: { testSeriesId: string };
      };
      orderBy?: { submittedAt?: { sort: 'desc'; nulls?: 'first' | 'last' } };
      take?: number;
    }) => {
      const inSeries = where.test?.testSeriesId;
      const matched = this.data.attempts.filter(
        (row) =>
          row.studentId === where.studentId &&
          row.status === where.status &&
          (where.id === undefined || row.id === where.id) &&
          (where.testId === undefined || row.testId === where.testId) &&
          (inSeries === undefined ||
            this.data.tests.some(
              (test) => test.testSeriesId === inSeries && test.id === row.testId,
            )),
      );
      const ordered = matched.toSorted(newestFirst(orderBy?.submittedAt?.nulls === 'last'));
      return Promise.resolve(ordered.slice(0, take).map((row) => this.reported(row)));
    },

    /** Prisma hands back the Decimal the column holds, so a payload leaks one unless it converts. */
    groupBy: ({
      where,
    }: {
      where: { testId: string; isGraded: boolean; status: AttemptStatus };
    }) => {
      const counts = new Map<number, number>();
      for (const row of this.data.attempts) {
        const matches =
          row.testId === where.testId &&
          row.isGraded === where.isGraded &&
          row.status === where.status;
        if (!matches || row.score === null) continue;
        counts.set(row.score, (counts.get(row.score) ?? 0) + 1);
      }
      return Promise.resolve(
        [...counts].map(([score, count]) => ({ score: new Prisma.Decimal(score), _count: count })),
      );
    },
  };

  readonly student = {
    /** The scoped read: a branch filter, and `in: []` matching nobody exactly as Prisma does. */
    findFirst: ({
      where,
    }: {
      where: { id: string; deletedAt: null; currentBranchId?: { in: string[] } };
    }) =>
      Promise.resolve(
        this.data.students.find(
          (row) =>
            row.id === where.id &&
            row.deletedAt === null &&
            (where.currentBranchId === undefined ||
              (typeof row.currentBranchId === 'string' &&
                where.currentBranchId.in.includes(row.currentBranchId))),
        ) ?? null,
      ),
  };

  private satBy(testSeriesId: string, studentId: string): boolean {
    return this.data.tests.some(
      (test) =>
        test.testSeriesId === testSeriesId &&
        this.data.attempts.some((row) => row.testId === test.id && row.studentId === studentId),
    );
  }

  private withRungs(row: { id: string; name: string; progressive?: boolean }) {
    return {
      id: row.id,
      name: row.name,
      progressive: row.progressive ?? false,
      tests: this.data.tests
        .filter((test) => test.testSeriesId === row.id)
        .map((test) => ({ id: test.id, seriesOrder: test.seriesOrder ?? null }))
        .toSorted((a, b) => (a.seriesOrder ?? 0) - (b.seriesOrder ?? 0)),
    };
  }

  readonly testSeries = {
    findFirst: ({
      where,
    }: {
      where: {
        id?: string;
        tests: { some: { attempts: { some: { studentId: string } } } };
      };
    }) => {
      const studentId = where.tests.some.attempts.some.studentId;
      const held = this.data.series.find(
        (row) => row.id === where.id && this.satBy(row.id, studentId),
      );
      return Promise.resolve(held === undefined ? null : this.withRungs(held));
    },

    findMany: ({
      where,
    }: {
      where: {
        tests: { some: { attempts: { some: { studentId: string } } } };
      };
    }) => {
      const studentId = where.tests.some.attempts.some.studentId;
      return Promise.resolve(
        this.data.series
          .filter((row) => this.satBy(row.id, studentId))
          .map((row) => ({ id: row.id, name: row.name, progressive: row.progressive ?? false }))
          .toSorted((a, b) => a.name.localeCompare(b.name)),
      );
    },
  };

  readonly testStat = {
    findMany: ({ where }: { where: { testId: { in: string[] } } }) =>
      Promise.resolve(
        this.data.testStats
          .filter((row) => where.testId.in.includes(row.testId))
          .map((row) => ({ sumTimeSec: 0, topperAttemptId: null, ...row })),
      ),

    findUnique: ({ where }: { where: { testId: string } }) => {
      const row = this.data.testStats.find((held) => held.testId === where.testId);
      if (!row) return Promise.resolve(null);
      return Promise.resolve({
        ...row,
        sumTimeSec: row.sumTimeSec ?? 0,
        topperAttemptId: row.topperAttemptId ?? null,
      });
    },
  };

  readonly testSectionStat = {
    findMany: ({ where }: { where: { testId: string } }) =>
      Promise.resolve(this.data.sectionStats.filter((row) => row.testId === where.testId)),
  };

  readonly testQuestionStat = {
    findMany: ({ where }: { where: { testId: string | { in: string[] } } }) => {
      const matches = (testId: string) =>
        typeof where.testId === 'string'
          ? testId === where.testId
          : where.testId.in.includes(testId);
      // The p-value read asks only for measured rows; the question report wants them all.
      const measuredOnly = typeof where.testId !== 'string';
      return Promise.resolve(
        this.data.questionStats
          .filter((row) => matches(row.testId) && (!measuredOnly || row.pValue !== null))
          .map((row) => ({
            attemptedCount: 0,
            skippedCount: 0,
            correctCount: 0,
            sumTimeSec: 0,
            optionCounts: null,
            ...row,
          })),
      );
    },
  };

  asService(): PrismaService {
    return this as unknown as PrismaService;
  }
}

// --------------------------------------------------------------------------- the leaderboard board
// ---------------------------------------------------------------------------

/** One sitting flattened with the student it belongs to — everything a board row could draw on. */
export interface FakeBoardSitting {
  id: string;
  testId: string;
  studentId: string;
  isGraded: boolean;
  status: AttemptStatus;
  score: number | null;
  lastRank: number | null;
  startedAt: Date;
  submittedAt: Date | null;
  fullName: string | null;
  branch: string | null;
  mobile: string;
}

export function makeBoardSitting(overrides: Partial<FakeBoardSitting> = {}): FakeBoardSitting {
  const startedAt = overrides.startedAt ?? new Date('2026-09-01T05:00:00.000Z');
  return {
    id: 'att_1',
    testId: 'tst_1',
    studentId: 'stu_1',
    isGraded: true,
    status: ATTEMPT_STATUS.EVALUATED,
    score: 60,
    lastRank: null,
    startedAt,
    submittedAt: new Date(startedAt.getTime() + 20 * 60_000),
    fullName: 'Sai Teja Reddy',
    branch: 'AMEERPET',
    mobile: '9876500001',
    ...overrides,
  };
}

/** The papers a board can be asked about, and the series that group them. */
export interface FakeBoardTest {
  id: string;
  title: string | null;
  evaluationMode: EvaluationMode;
}

export interface FakeBoardSeries {
  id: string;
  name: string;
  testIds: string[];
}

/** Rows a ranked aggregate would return. Postgres does that ranking, so a test hands it over. */
export interface FakeBoardPointsRow {
  rank: number;
  points: number;
  sittings: number;
  cohort: number;
  name: string | null;
  branch: string | null;
  is_you: boolean;
  prior_rank: number | null;
}

export class FakeBoardPrisma {
  constructor(
    readonly sittings: FakeBoardSitting[] = [],
    readonly tests: FakeBoardTest[] = [],
    readonly series: FakeBoardSeries[] = [],
    readonly points: FakeBoardPointsRow[] = [],
  ) {}

  /** What the raw ranking query was asked, so a test can prove it ran rather than guessing. */
  rawReads = 0;

  private testOf(testId: string): FakeBoardTest {
    return (
      this.tests.find((row) => row.id === testId) ?? {
        id: testId,
        title: null,
        evaluationMode: EVALUATION_MODE.RANKED,
      }
    );
  }

  readonly attempt = {
    findFirst: ({
      where,
    }: {
      where: { testId: string; studentId: string; isGraded: boolean; status: AttemptStatus };
    }) => {
      const row = this.sittings.find(
        (sitting) =>
          sitting.testId === where.testId &&
          sitting.studentId === where.studentId &&
          sitting.isGraded === where.isGraded &&
          sitting.status === where.status,
      );
      if (!row) return Promise.resolve(null);
      const test = this.testOf(row.testId);
      return Promise.resolve({
        id: row.id,
        lastRank: row.lastRank,
        test: { title: test.title, evaluationMode: test.evaluationMode },
      });
    },

    /** Hands back only what the select asks for: a leak here would be the code's, not the fake's. */
    findMany: ({ where }: { where: { id: { in: string[] } } }) =>
      Promise.resolve(
        this.sittings
          .filter((row) => where.id.in.includes(row.id))
          .map((row) => ({
            id: row.id,
            score: row.score,
            lastRank: row.lastRank,
            student: {
              fullName: row.fullName,
              currentBranch: row.branch === null ? null : { name: row.branch },
            },
          })),
      ),
  };

  readonly testSeries = {
    findFirst: ({ where }: { where: { id: string } }) => {
      const row = this.series.find((candidate) => candidate.id === where.id);
      if (!row) return Promise.resolve(null);
      return Promise.resolve({
        name: row.name,
        tests: row.testIds.map((id) => ({ id })),
      });
    },
  };

  $queryRaw() {
    this.rawReads += 1;
    return Promise.resolve(this.points);
  }

  asService(): PrismaService {
    return this as unknown as PrismaService;
  }
}

// --------------------------------------------------------------------------- the public share
// ---------------------------------------------------------------------------

/** One link, exactly as the column holds it — the fake never decides whether it is still open. */
export interface FakeShareRow {
  id: string;
  token: string;
  attemptId: string;
  createdByAdminId: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export function makeShare(overrides: Partial<FakeShareRow> = {}): FakeShareRow {
  return {
    id: 'shr_1',
    token: 'a-token-nobody-guessed',
    attemptId: 'att_1',
    createdByAdminId: null,
    expiresAt: null,
    revokedAt: null,
    createdAt: new Date('2026-08-30T06:00:00.000Z'),
    ...overrides,
  };
}

/** A sitting flattened with the identity a shared report is allowed to name, and nothing else. */
export interface FakeShareSitting {
  id: string;
  studentId: string;
  status: AttemptStatus;
  submittedAt: Date | null;
  title: string | null;
  fullName: string | null;
  branch: string | null;
  branchId: string | null;
  studentDeletedAt: Date | null;
}

export function makeShareSitting(overrides: Partial<FakeShareSitting> = {}): FakeShareSitting {
  return {
    id: 'att_1',
    studentId: 'stu_1',
    status: ATTEMPT_STATUS.EVALUATED,
    submittedAt: new Date('2026-08-20T06:00:00.000Z'),
    title: 'SSC CGL Tier 1 — Mock 1',
    fullName: 'Harshith Diyyala',
    branch: 'AMEERPET',
    branchId: 'br_1',
    studentDeletedAt: null,
    ...overrides,
  };
}

interface ShareWhere {
  id?: string;
  token?: string;
  status?: AttemptStatus;
  studentId?: string;
  revokedAt?: null;
  deletedAt?: null;
  currentBranchId?: { in: string[] };
  student?: { deletedAt: null };
  attempt?: { studentId: string };
}

/** Only the columns a share touches. The report itself is built by the analytics fake beside it. */
export class FakeSharePrisma {
  constructor(
    readonly shares: FakeShareRow[] = [],
    readonly sittings: FakeShareSitting[] = [],
  ) {}

  private minted = 0;

  private sittingOf(attemptId: string): FakeShareSitting | undefined {
    return this.sittings.find((row) => row.id === attemptId);
  }

  private projected(row: FakeShareRow) {
    const sitting = this.sittingOf(row.attemptId);
    return {
      ...row,
      attempt: {
        submittedAt: sitting?.submittedAt ?? null,
        test: { title: sitting?.title ?? null },
      },
    };
  }

  private ownedBy(row: FakeShareRow, studentId: string): boolean {
    return this.sittingOf(row.attemptId)?.studentId === studentId;
  }

  readonly performanceShare = {
    findUnique: ({ where }: { where: { token: string } }) =>
      Promise.resolve(this.shares.find((row) => row.token === where.token) ?? null),

    findFirst: ({ where }: { where: ShareWhere }) => {
      const found = this.shares.find(
        (row) =>
          row.id === where.id &&
          (where.attempt === undefined || this.ownedBy(row, where.attempt.studentId)),
      );
      return Promise.resolve(found === undefined ? null : this.projected(found));
    },

    findMany: ({ where }: { where: { attempt: { studentId: string } } }) =>
      Promise.resolve(
        this.shares
          .filter((row) => this.ownedBy(row, where.attempt.studentId))
          .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map((row) => this.projected(row)),
      ),

    create: ({
      data,
    }: {
      data: {
        token: string;
        attemptId: string;
        createdByAdminId: string | null;
        expiresAt: Date | null;
      };
    }) => {
      this.minted += 1;
      const row: FakeShareRow = {
        ...data,
        id: `shr_${this.minted}`,
        revokedAt: null,
        createdAt: new Date(),
      };
      this.shares.push(row);
      return Promise.resolve(this.projected(row));
    },

    updateMany: ({ where, data }: { where: ShareWhere; data: { revokedAt: Date } }) => {
      const matched = this.shares.filter(
        (row) =>
          row.id === where.id &&
          (where.attempt === undefined || this.ownedBy(row, where.attempt.studentId)) &&
          (where.revokedAt === undefined || row.revokedAt === null),
      );
      for (const row of matched) row.revokedAt = data.revokedAt;
      return Promise.resolve({ count: matched.length });
    },
  };

  readonly attempt = {
    findFirst: ({ where }: { where: ShareWhere }) => {
      const found = this.sittings.find(
        (row) =>
          row.id === where.id &&
          (where.status === undefined || row.status === where.status) &&
          (where.studentId === undefined || row.studentId === where.studentId) &&
          (where.student === undefined || row.studentDeletedAt === null),
      );
      if (found === undefined) return Promise.resolve(null);
      return Promise.resolve({
        id: found.id,
        studentId: found.studentId,
        submittedAt: found.submittedAt,
        student: {
          fullName: found.fullName,
          currentBranch: found.branch === null ? null : { name: found.branch },
        },
      });
    },

    findMany: ({ where, take }: { where: ShareWhere; take?: number }) =>
      Promise.resolve(
        this.sittings
          .filter((row) => row.studentId === where.studentId && row.status === where.status)
          .toSorted((a, b) => (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0))
          .slice(0, take)
          .map((row) => ({
            id: row.id,
            submittedAt: row.submittedAt,
            test: { title: row.title },
          })),
      ),
  };

  /** The student behind a sitting, so a branch-scoped admin reads one of another branch as missing. */
  readonly student = {
    findFirst: ({ where }: { where: ShareWhere }) => {
      const sitting = this.sittings.find(
        (row) => row.studentId === where.id && row.studentDeletedAt === null,
      );
      if (sitting === undefined) return Promise.resolve(null);
      const reachable =
        where.currentBranchId === undefined ||
        (sitting.branchId !== null && where.currentBranchId.in.includes(sitting.branchId));
      return Promise.resolve(reachable ? { id: sitting.studentId } : null);
    },
  };

  asService(): PrismaService {
    return this as unknown as PrismaService;
  }
}

// --------------------------------------------------------------------------- the rollup's tables
// ---------------------------------------------------------------------------

export interface FakeStudentStatRow {
  studentId: string;
  testsAttempted: number;
  testsEvaluated: number;
  sumScore: number;
  sumPercentile: number;
  bestPercentile: number | null;
  totalAnswered: number;
  totalCorrect: number;
  totalWrong: number;
  totalUnattempted: number;
  sumTimeSec: number;
  practiceAttempts: number;
  lastAttemptAt: Date | null;
  computedThrough: Date | null;
  computedAt: Date | null;
}

export interface FakeStudentSubjectStatRow {
  studentId: string;
  subjectId: string;
  scope: TestScope;
  evaluationMode: EvaluationMode;
  attempted: number;
  correct: number;
  wrong: number;
  sumTimeSec: number;
  computedAt: Date | null;
}

/** One `StudentSubjectStat` row with the subject name the overview joins to. */
export interface FakeOverviewSubjectRow {
  studentId: string;
  subjectId: string;
  subjectName: string;
  scope: TestScope;
  evaluationMode: EvaluationMode;
  attempted: number;
  correct: number;
  sumTimeSec: number;
}

export interface FakeOverviewData {
  stats: FakeStudentStatRow[];
  subjects: FakeOverviewSubjectRow[];
  students: { id: string; deletedAt: Date | null; currentBranchId: string | null }[];
}

/** The dashboard's whole world, handing back Decimal and BigInt exactly as Prisma does. */
export class FakeOverviewPrisma {
  constructor(private readonly data: FakeOverviewData) {}

  readonly studentStat = {
    findUnique: ({ where }: { where: { studentId: string } }) => {
      const row = this.data.stats.find((held) => held.studentId === where.studentId);
      if (!row) return Promise.resolve(null);
      return Promise.resolve({
        ...row,
        sumScore: new Prisma.Decimal(row.sumScore),
        sumPercentile: new Prisma.Decimal(row.sumPercentile),
        bestPercentile: row.bestPercentile === null ? null : new Prisma.Decimal(row.bestPercentile),
        sumTimeSec: BigInt(row.sumTimeSec),
      });
    },
  };

  readonly studentSubjectStat = {
    findMany: ({ where }: { where: { studentId: string } }) =>
      Promise.resolve(
        this.data.subjects
          .filter((row) => row.studentId === where.studentId)
          .map((row) => ({
            subjectId: row.subjectId,
            scope: row.scope,
            evaluationMode: row.evaluationMode,
            attempted: row.attempted,
            correct: row.correct,
            sumTimeSec: BigInt(row.sumTimeSec),
            subject: { name: row.subjectName },
          })),
      ),
  };

  readonly student = {
    /** The scoped read: a branch filter, and `in: []` matching nobody exactly as Prisma does. */
    findFirst: ({
      where,
    }: {
      where: { id: string; deletedAt: null; currentBranchId?: { in: string[] } };
    }) =>
      Promise.resolve(
        this.data.students.find(
          (row) =>
            row.id === where.id &&
            row.deletedAt === null &&
            (where.currentBranchId === undefined ||
              (row.currentBranchId !== null &&
                where.currentBranchId.in.includes(row.currentBranchId))),
        ) ?? null,
      ),
  };
}

export interface FakeTestStatRow {
  testId: string;
  attemptCount: number;
  evaluatedCount: number;
  sumScore: number;
  maxScore: number | null;
  minScore: number | null;
  sumTimeSec: number;
  scoreHistogram: unknown;
  topperAttemptId: string | null;
  attemptsIncluded: number;
  computedAt: Date | null;
}

export interface FakeTestSectionStatRow {
  testId: string;
  baseConfigSectionId: string;
  attempted: number;
  sumScore: number;
  sumTimeSec: number;
  computedAt: Date | null;
}

export interface FakeTestQuestionStatRow {
  testId: string;
  paperQuestionId: string;
  questionId: string;
  attemptedCount: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  sumTimeSec: number;
  optionCounts: unknown;
  pValue: number | null;
  computedAt: Date | null;
}

export interface FakeProcessedRollupRow {
  attemptId: string;
  rollupType: string;
}

/** The test the fold reads its bucketing off — a rollup never needs more of one than this. */
export interface FakeRollupTest {
  id: string;
  scope: TestScope;
  evaluationMode: EvaluationMode;
}

export function makeRollupTest(overrides: Partial<FakeRollupTest> = {}): FakeRollupTest {
  return {
    id: 'tst_1',
    scope: TEST_SCOPE.FULL,
    evaluationMode: EVALUATION_MODE.RANKED,
    ...overrides,
  };
}

function isIncrement(value: unknown): value is { increment: number | bigint } {
  return typeof value === 'object' && value !== null && 'increment' in value;
}

function isIn(value: unknown): value is { in: unknown[] } {
  return typeof value === 'object' && value !== null && 'in' in value;
}

/** Prisma's atomic `{ increment }`, and BigInt columns kept as the plain numbers a test reads. */
function applyWrite(row: Record<string, unknown>, data: Record<string, unknown>): void {
  for (const [column, value] of Object.entries(data)) {
    if (isIncrement(value)) {
      row[column] = Number(row[column] ?? 0) + Number(value.increment);
    } else {
      row[column] = typeof value === 'bigint' ? Number(value) : value;
    }
  }
}

/** A compound-key `where` arrives wrapped in its index name; the row it names is flat. */
function flatWhere(where: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(where)) {
    const nested =
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      !(value instanceof Date);
    if (nested && !isIn(value)) Object.assign(flat, value);
    else flat[column] = value;
  }
  return flat;
}

function matchesRow(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([column, value]) =>
    isIn(value) ? value.in.includes(row[column]) : row[column] === value,
  );
}

/** The row a fixture was built with. Throws rather than asserts, so a bad setup names itself. */
export function rowAt<T>(rows: readonly T[], index = 0): T {
  const row = rows[index];
  if (row === undefined) throw new Error(`This fixture has no row ${index}`);
  return row;
}

/** A typed row read as the loose bag every write below indexes into. */
const fields = (row: object): Record<string, unknown> => row as Record<string, unknown>;

/** One aggregate table: rows behind a key, and only the writes the rollup makes to them. */
class FakeStatTable<Row extends object> {
  readonly rows: Row[] = [];

  constructor(
    private readonly key: readonly string[],
    private readonly blank: Record<string, unknown>,
  ) {}

  private keyOf(row: Record<string, unknown>): string {
    return this.key.map((column) => String(row[column])).join('|');
  }

  private held(where: Record<string, unknown>): Row | undefined {
    const wanted = this.keyOf(flatWhere(where));
    return this.rows.find((row) => this.keyOf(fields(row)) === wanted);
  }

  private inserted(data: Record<string, unknown>): Row {
    const row = { ...this.blank };
    applyWrite(row, data);
    this.rows.push(row as Row);
    return row as Row;
  }

  readonly findUnique = ({ where }: { where: Record<string, unknown> }) =>
    Promise.resolve(this.held(where) ?? null);

  readonly findUniqueOrThrow = ({ where }: { where: Record<string, unknown> }) => {
    const row = this.held(where);
    if (!row) throw new Error(`no stat row for ${JSON.stringify(where)}`);
    return Promise.resolve(row);
  };

  readonly findMany = ({ where = {} }: { where?: Record<string, unknown> } = {}) =>
    Promise.resolve(this.rows.filter((row) => matchesRow(fields(row), where)));

  readonly upsert = ({
    where,
    create,
    update,
  }: {
    where: Record<string, unknown>;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }) => {
    const held = this.held(where);
    if (held === undefined) return Promise.resolve(this.inserted(create));
    applyWrite(fields(held), update);
    return Promise.resolve(held);
  };

  readonly update = ({
    where,
    data,
  }: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }) => {
    const held = this.held(where);
    if (!held) throw new Error(`no stat row for ${JSON.stringify(where)}`);
    applyWrite(fields(held), data);
    return Promise.resolve(held);
  };

  readonly createMany = ({ data }: { data: Record<string, unknown>[] }) => {
    for (const row of data) this.inserted(row);
    return Promise.resolve({ count: data.length });
  };

  readonly deleteMany = ({ where }: { where: Record<string, unknown> }) => {
    const kept = this.rows.filter((row) => !matchesRow(fields(row), where));
    const count = this.rows.length - kept.length;
    this.rows.length = 0;
    this.rows.push(...kept);
    return Promise.resolve({ count });
  };
}

/** The clauses the rollup narrows `Attempt` by, and nothing else. */
interface FakeRollupAttemptWhere {
  id?: string | { in: string[] };
  testId?: string;
  studentId?: string;
  isGraded?: boolean;
  status?: AttemptStatus;
  attemptNo?: { lt?: number; gt?: number };
  evaluatedAt?: Date | { lt: Date } | null;
  test?: { evaluationMode: EvaluationMode };
  OR?: FakeRollupAttemptWhere[];
}

function comparesNumber(value: number, filter: { lt?: number; gt?: number }): boolean {
  if (filter.lt !== undefined && value >= filter.lt) return false;
  return filter.gt === undefined || value > filter.gt;
}

function comparesInstant(at: Date | null, filter: Date | { lt: Date } | null): boolean {
  if (filter === null) return at === null;
  if (at === null) return false;
  return filter instanceof Date ? at.getTime() === filter.getTime() : at < filter.lt;
}

/** The rollup's whole world, and the scorer's too, so a test can score a sitting and then fold it. */
export class FakeRollupPrisma {
  constructor(
    readonly attempts: FakeAttemptRow[] = [],
    readonly served: FakeServedAnswerRow[] = [],
    readonly tests: FakeRollupTest[] = [makeRollupTest()],
  ) {}

  readonly outboxEvents: FakeOutboxRow[] = [];

  readonly processedRollups: FakeProcessedRollupRow[] = [];

  readonly studentStat = new FakeStatTable<FakeStudentStatRow>(['studentId'], {
    testsAttempted: 0,
    testsEvaluated: 0,
    sumScore: 0,
    sumPercentile: 0,
    bestPercentile: null,
    totalAnswered: 0,
    totalCorrect: 0,
    totalWrong: 0,
    totalUnattempted: 0,
    sumTimeSec: 0,
    practiceAttempts: 0,
    lastAttemptAt: null,
    computedThrough: null,
    computedAt: null,
  });

  readonly studentSubjectStat = new FakeStatTable<FakeStudentSubjectStatRow>(
    ['studentId', 'subjectId', 'scope', 'evaluationMode'],
    { attempted: 0, correct: 0, wrong: 0, sumTimeSec: 0, computedAt: null },
  );

  readonly testStat = new FakeStatTable<FakeTestStatRow>(['testId'], {
    attemptCount: 0,
    evaluatedCount: 0,
    sumScore: 0,
    maxScore: null,
    minScore: null,
    sumTimeSec: 0,
    scoreHistogram: null,
    topperAttemptId: null,
    attemptsIncluded: 0,
    computedAt: null,
  });

  readonly testSectionStat = new FakeStatTable<FakeTestSectionStatRow>(
    ['testId', 'baseConfigSectionId'],
    { attempted: 0, sumScore: 0, sumTimeSec: 0, computedAt: null },
  );

  readonly testQuestionStat = new FakeStatTable<FakeTestQuestionStatRow>(
    ['testId', 'paperQuestionId'],
    {
      attemptedCount: 0,
      correctCount: 0,
      wrongCount: 0,
      skippedCount: 0,
      sumTimeSec: 0,
      optionCounts: null,
      pValue: null,
      computedAt: null,
    },
  );

  private outboxSeq = 0;

  readonly outboxEvent = {
    create: ({ data }: { data: FakeOutboxInput }) => {
      this.outboxSeq += 1;
      const created: FakeOutboxRow = {
        ...data,
        id: `obx_${this.outboxSeq}`,
        createdAt: new Date(this.outboxSeq),
        processedAt: null,
      };
      this.outboxEvents.push(created);
      return Promise.resolve({ id: created.id });
    },

    findMany: ({ where, take }: { where: FakeOutboxWhere; take?: number }) =>
      Promise.resolve(
        this.outboxEvents.filter((row) => matchesOutboxWhere(row, where)).slice(0, take),
      ),

    update: ({ where, data }: { where: { id: string }; data: { processedAt: Date } }) => {
      const row = this.outboxEvents.find((candidate) => candidate.id === where.id);
      if (!row) throw new Error(`no outbox row ${where.id}`);
      row.processedAt = data.processedAt;
      return Promise.resolve(row);
    },
  };

  /** The guard. `createMany` without `skipDuplicates` is how a redelivered fold is refused. */
  readonly processedRollup = {
    createMany: ({
      data,
      skipDuplicates,
    }: {
      data: FakeProcessedRollupRow[];
      skipDuplicates?: boolean;
    }) => {
      const fresh = data.filter(
        (row) =>
          !this.processedRollups.some(
            (held) => held.attemptId === row.attemptId && held.rollupType === row.rollupType,
          ),
      );
      if (fresh.length < data.length && skipDuplicates !== true) {
        throw uniqueViolation('attemptId_rollupType');
      }
      this.processedRollups.push(...fresh);
      return Promise.resolve({ count: fresh.length });
    },

    findMany: ({ where = {} }: { where?: { rollupType?: string } } = {}) =>
      Promise.resolve(
        this.processedRollups.filter(
          (row) => where.rollupType === undefined || row.rollupType === where.rollupType,
        ),
      ),

    deleteMany: ({
      where,
    }: {
      where: { rollupType?: { in: string[] }; attempt?: { testId?: string; studentId?: string } };
    }) => {
      const kept = this.processedRollups.filter((row) => {
        const sitting = this.attempts.find((candidate) => candidate.id === row.attemptId);
        const typed = where.rollupType?.in.includes(row.rollupType) ?? true;
        const scoped =
          (where.attempt?.testId === undefined || sitting?.testId === where.attempt.testId) &&
          (where.attempt?.studentId === undefined ||
            sitting?.studentId === where.attempt.studentId);
        return !(typed && scoped);
      });
      const count = this.processedRollups.length - kept.length;
      this.processedRollups.length = 0;
      this.processedRollups.push(...kept);
      return Promise.resolve({ count });
    },
  };

  /** Both selects at once: the scorer's answer key and the fold's subjects off one row. */
  private joined(row: FakeAttemptRow) {
    const test = this.tests.find((candidate) => candidate.id === row.testId) ?? makeRollupTest();
    return {
      ...row,
      test: { scope: test.scope, evaluationMode: test.evaluationMode },
      questions: this.served
        .filter((served) => served.attemptId === row.id)
        .sort((a, b) => a.order - b.order)
        .map((served) => ({
          ...served,
          question: { type: served.type, subjectId: served.subjectId },
          questionVersion: { options: served.options, answerKey: served.answerKey },
        })),
    };
  }

  private matchesId(row: FakeAttemptRow, id: FakeRollupAttemptWhere['id']): boolean {
    if (id === undefined) return true;
    return typeof id === 'string' ? row.id === id : id.in.includes(row.id);
  }

  /** The clauses that are a plain equals, the mode among them because the test carries it. */
  private sameColumns(row: FakeAttemptRow, where: FakeRollupAttemptWhere): boolean {
    const asked: [unknown, unknown][] = [
      [where.testId, row.testId],
      [where.studentId, row.studentId],
      [where.isGraded, row.isGraded],
      [where.status, row.status],
      [where.test?.evaluationMode, this.modeOf(row)],
    ];
    return asked.every(([wanted, held]) => wanted === undefined || wanted === held);
  }

  private matches(row: FakeAttemptRow, where: FakeRollupAttemptWhere): boolean {
    if (!this.matchesId(row, where.id)) return false;
    if (!this.sameColumns(row, where)) return false;
    if (where.attemptNo && !comparesNumber(row.attemptNo, where.attemptNo)) return false;
    if (where.evaluatedAt !== undefined && !comparesInstant(row.evaluatedAt, where.evaluatedAt)) {
      return false;
    }
    return where.OR === undefined || where.OR.some((clause) => this.matches(row, clause));
  }

  private modeOf(row: FakeAttemptRow): EvaluationMode {
    const test = this.tests.find((candidate) => candidate.id === row.testId);
    return test?.evaluationMode ?? EVALUATION_MODE.RANKED;
  }

  readonly attempt = {
    findUnique: ({ where }: { where: { id: string } }) => {
      const row = this.attempts.find((candidate) => candidate.id === where.id);
      return Promise.resolve(row ? this.joined(row) : null);
    },

    findMany: ({
      where = {},
      distinct,
    }: {
      where?: FakeRollupAttemptWhere;
      orderBy?: unknown;
      distinct?: ('studentId' | 'testId')[];
      select?: unknown;
    } = {}) => {
      // Always ordered as the rollup asks for them: oldest evaluation first, then attempt number.
      const matched = this.attempts
        .filter((row) => this.matches(row, where))
        .toSorted(
          (a, b) =>
            (a.evaluatedAt?.getTime() ?? 0) - (b.evaluatedAt?.getTime() ?? 0) ||
            a.attemptNo - b.attemptNo,
        );
      const seen = new Set<string>();
      const kept = matched.filter((row) => {
        if (!distinct) return true;
        const key = distinct.map((column) => row[column]).join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return Promise.resolve(kept.map((row) => this.joined(row)));
    },

    count: ({ where }: { where: FakeRollupAttemptWhere }) =>
      Promise.resolve(this.attempts.filter((row) => this.matches(row, where)).length),

    update: ({ where, data }: { where: { id: string }; data: Partial<FakeAttemptRow> }) => {
      const row = this.attempts.find((candidate) => candidate.id === where.id);
      if (!row) throw new Error(`no attempt ${where.id}`);
      Object.assign(row, data);
      return Promise.resolve(row);
    },

    updateMany: ({
      where,
      data,
    }: {
      where: FakeRollupAttemptWhere;
      data: Partial<FakeAttemptRow>;
    }) => {
      const matched = this.attempts.filter((row) => this.matches(row, where));
      for (const row of matched) Object.assign(row, data);
      return Promise.resolve({ count: matched.length });
    },
  };

  readonly attemptQuestion = {
    updateMany: ({
      where,
      data,
    }: {
      where: { attemptId: string; questionId: { in: string[] } };
      data: { isCorrect: boolean | null; marksAwarded: number };
    }) => {
      const matched = this.served.filter(
        (row) => row.attemptId === where.attemptId && where.questionId.in.includes(row.questionId),
      );
      for (const row of matched) Object.assign(row, data);
      return Promise.resolve({ count: matched.length });
    },
  };

  private tables(): object[][] {
    return [
      this.attempts,
      this.served,
      this.outboxEvents,
      this.processedRollups,
      this.studentStat.rows,
      this.studentSubjectStat.rows,
      this.testStat.rows,
      this.testSectionStat.rows,
      this.testQuestionStat.rows,
    ];
  }

  /** Both forms, and a throwing callback puts every table back — the guard relies on that. */
  async $transaction<T>(
    work: Promise<T>[] | ((tx: FakeRollupPrisma) => Promise<T>),
  ): Promise<T[] | T> {
    if (typeof work !== 'function') return Promise.all(work);

    const tables = this.tables();
    const snapshot = tables.map((rows) => rows.map((row) => structuredClone(row)));
    try {
      return await work(this);
    } catch (error) {
      tables.forEach((rows, index) => {
        rows.length = 0;
        rows.push(...(snapshot[index] ?? []));
      });
      throw error;
    }
  }

  asService(): PrismaService {
    return this as unknown as PrismaService;
  }
}

/** The seam an evaluated sitting reaches the rollup queue through. */
export function fakeRollupOutbox(
  prisma: { asService(): PrismaService },
  queue: FakeQueue,
): RollupOutbox {
  return new RollupOutbox(prisma.asService(), queue.asQueue());
}

// ----------------------------------------------------------------------------
// StudentPrivacyService — consent rows, one profile and the sittings that survive erasure
// ----------------------------------------------------------------------------

export interface FakeConsentRow {
  id: string;
  studentId: string;
  purpose: 'PLATFORM';
  version: string;
  granted: boolean;
  recordedAt: Date;
}

export interface FakePrivacyProfile {
  studentId: string;
  motherName?: string | null;
  fatherName?: string | null;
  dob?: Date | null;
  email?: string | null;
  address?: string | null;
  gender?: string | null;
  photoUrl?: string | null;
  tenthMarksheetUrl?: string | null;
  educationDetails?: unknown;
  pastExamHistory?: unknown;
  aadhaarVerified?: boolean;
  panVerified?: boolean;
}

export interface FakePrivacyAttempt {
  id: string;
  studentId: string;
  testId: string;
  status?: string;
  startedAt?: Date | null;
  submittedAt?: Date | null;
  score?: number | null;
  lastPercentile?: number | null;
  createdAt?: Date;
}

export interface FakePrivacyWorld {
  students?: FakeStudent[];
  branches?: FakeBranch[];
  profiles?: FakePrivacyProfile[];
  attempts?: FakePrivacyAttempt[];
  /** Makes every consent write throw, which is the only way to prove a signup survives one. */
  failing?: boolean;
}

export class FakePrivacyPrisma {
  readonly students: FakeStudent[];
  readonly branches: FakeBranch[];
  readonly profiles: FakePrivacyProfile[];
  readonly attempts: FakePrivacyAttempt[];
  readonly consents: FakeConsentRow[] = [];
  private seq = 0;

  constructor(private readonly world: FakePrivacyWorld = {}) {
    this.students = world.students ?? [];
    this.branches = world.branches ?? [];
    this.profiles = world.profiles ?? [];
    this.attempts = world.attempts ?? [];
  }

  asService(): PrismaService {
    return this as unknown as PrismaService;
  }

  $transaction<T>(work: (tx: FakePrivacyPrisma) => Promise<T>): Promise<T> {
    return work(this);
  }

  readonly studentConsent = {
    create: ({ data }: { data: Omit<FakeConsentRow, 'id' | 'recordedAt'> }) => {
      if (this.world.failing) return Promise.reject(new Error('postgres is down'));
      this.seq += 1;
      const row: FakeConsentRow = { ...data, id: `csn_${this.seq}`, recordedAt: new Date() };
      this.consents.push(row);
      return Promise.resolve(row);
    },

    findMany: ({ where }: { where: { studentId: string } }) =>
      Promise.resolve(
        this.consents
          .filter((row) => row.studentId === where.studentId)
          .slice()
          .reverse(),
      ),
  };

  readonly student = {
    findFirst: ({ where }: { where: Record<string, unknown> }) => {
      const found = this.students.find(
        (student) =>
          student.id === where.id &&
          (where.deletedAt === undefined || student.deletedAt === null) &&
          matchesBranchFilter(student, where.currentBranchId),
      );
      if (!found) return Promise.resolve(null);
      const branch = this.branches.find((row) => row.id === found.currentBranchId);
      return Promise.resolve({
        ...found,
        profile: this.profiles.find((row) => row.studentId === found.id) ?? null,
        currentBranch: branch ? { name: branch.name } : null,
      });
    },

    update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const student = this.students.find((row) => row.id === where.id);
      Object.assign(student as object, data);
      return Promise.resolve(student);
    },
  };

  readonly studentProfile = {
    updateMany: ({
      where,
      data,
    }: {
      where: { studentId: string };
      data: Record<string, unknown>;
    }) => {
      for (const profile of this.profiles.filter((row) => row.studentId === where.studentId)) {
        // Prisma's DbNull sentinel means "write SQL NULL", which is a null on the fake.
        Object.assign(profile, Object.fromEntries(Object.entries(data).map(nulled)));
      }
      return Promise.resolve({ count: 1 });
    },
  };

  readonly attempt = {
    findMany: ({ where }: { where: { studentId: string } }) =>
      Promise.resolve(
        this.attempts
          .filter((row) => row.studentId === where.studentId)
          .map((row) => ({
            status: 'EVALUATED',
            startedAt: null,
            submittedAt: null,
            lastPercentile: null,
            createdAt: new Date(),
            ...row,
            test: { title: `Test ${row.testId}` },
          })),
      ),

    count: ({ where }: { where: { studentId: string } }) =>
      Promise.resolve(this.attempts.filter((row) => row.studentId === where.studentId).length),
  };
}

const nulled = ([key, value]: [string, unknown]): [string, unknown] => [
  key,
  value !== null && typeof value === 'object' ? null : value,
];

/** `undefined` means the caller applied no branch narrowing at all. */
function matchesBranchFilter(student: FakeStudent, filter: unknown): boolean {
  if (filter === undefined) return true;
  const wanted = (filter as { in?: string[] }).in ?? [];
  return student.currentBranchId !== null && wanted.includes(student.currentBranchId);
}

/** Counting is not what a submit test is about, so the fake only has to be silent. */
export class FakeMetrics {
  readonly submits: string[] = [];

  countSubmit(outcome: string): void {
    this.submits.push(outcome);
  }

  observeRequest(): void {
    // A unit test never goes through the interceptor.
  }

  asService(): MetricsService {
    return this as unknown as MetricsService;
  }
}
