import { type AdminPermissions, AppException, ErrorCodes } from '@iace/contracts';
import { type Env } from '../../src/config/env.schema';
import { type AppConfigService } from '../../src/config/app-config.service';
import { type RedisService } from '../../src/redis/redis.service';
import { type MetricsService } from '../../src/common/metrics';
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
  type PushTarget,
  type WebPushSender,
} from '../../src/notifications/web-push.sender';
import { type FcmSender } from '../../src/notifications/fcm.sender';
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

/** Doubles for what a test never runs for real: Redis, config, queues, senders, storage and events. Never Postgres. */

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
  async replaceJson(
    key: string,
    was: string | null,
    value: unknown,
    ttlSec: number,
  ): Promise<boolean> {
    if ((this.text(key) ?? null) !== was) return false;
    await this.setJson(key, value, ttlSec);
    return true;
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length > 0) await this.client.del(...keys);
  }

  /** One thread, so the read and the delete are already atomic — the real one needs a script. */
  async deleteIndexedSet(indexKey: string, keyPrefix: string): Promise<string[]> {
    const entry = this.live(indexKey);
    const ids = entry?.value instanceof Set ? [...entry.value] : [];
    this.store.delete(indexKey);
    for (const id of ids) this.store.delete(`${keyPrefix}${id}`);
    return ids;
  }

  async ttl(key: string): Promise<number> {
    const ttl = await this.client.ttl(key);
    return Math.max(ttl, 0);
  }

  async acquireLock(key: string, holderId: string, ttlSec: number): Promise<boolean> {
    return (await this.client.set(key, holderId, 'EX', ttlSec, 'NX')) === 'OK';
  }

  async releaseLock(key: string, holderId: string): Promise<boolean> {
    if ((await this.client.get(key)) !== holderId) return false;
    await this.client.del(key);
    return true;
  }

  async holdLock(
    key: string,
    holderId: string,
    ttlSec: number,
    steal = false,
  ): Promise<string | null> {
    if ((await this.client.set(key, holderId, 'EX', ttlSec, 'NX')) === 'OK') return null;
    const holder = await this.client.get(key);
    if (holder !== null && holder !== holderId && !steal) return holder;
    await this.client.set(key, holderId, 'EX', ttlSec);
    return null;
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
  OTP_MAX_PER_DAY: 5,
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

/** In-memory `StorageService`, typed against the two methods it stands in for so a signature drift here fails the build rather than surfacing as a confusing test failure. */
export class FakeStorage implements Pick<
  StorageService,
  'upload' | 'objectSize' | 'read' | 'createDownloadUrl' | 'publicUrl'
> {
  objects = new Map<string, Buffer>();
  failNextUpload = false;
  private readonly reportedSizes = new Map<string, number>();

  upload(key: string, body: Buffer | Uint8Array | string, _contentType?: string) {
    if (this.failNextUpload) return Promise.reject(new Error('s3 is down'));
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body as Uint8Array | string);
    this.objects.set(key, buffer);
    return Promise.resolve();
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

  publicUrl(key: string): string {
    return `https://media.test/${key}`;
  }
}

// ---------------------------------------------------------------------------

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

/** A queue that only remembers, and collapses a held job id the way BullMQ silently does. */
export class FakeQueue {
  readonly jobs: {
    name: string;
    data: unknown;
    jobId?: string;
    removeOnComplete?: boolean;
    removeOnFail?: boolean;
    delay?: number;
  }[] = [];

  /** Set to make the next add throw: the crash between a commit and the queue. */
  failNext = false;

  add(
    name: string,
    data: unknown,
    options?: {
      jobId?: string;
      removeOnComplete?: boolean;
      removeOnFail?: boolean;
      delay?: number;
    },
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
    const delay = options?.delay === undefined ? {} : { delay: options.delay };
    this.jobs.push({
      name,
      data,
      jobId: options?.jobId,
      ...removeOnComplete,
      ...removeOnFail,
      ...delay,
    });
    return Promise.resolve();
  }

  asQueue<T>(): T {
    return this as unknown as T;
  }
}

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

/** The device context every session-creating call needs. */
export const NO_DEVICE: DeviceContext = {
  deviceName: null,
  ip: null,
  userAgent: null,
  client: null,
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

/** Whatever validates a list of codes before a student may carry them — the exam catalog, the program catalog. One shape, because the seam is `assertUsable(codes, fieldKey)` on both. */
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
export class FakePushSender implements Pick<WebPushSender, 'isConfigured' | 'send'> {
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

/** The FCM transport, faked: nothing in a test talks to Google. */
export class FakeFcmSender implements Pick<FcmSender, 'isConfigured' | 'send'> {
  readonly sent: { token: string; payload: PushPayload }[] = [];

  constructor(
    readonly isConfigured = true,
    private readonly gone: readonly string[] = [],
    private readonly failing: readonly string[] = [],
  ) {}

  send(token: string, payload: PushPayload): Promise<PushOutcome> {
    if (this.gone.includes(token)) return Promise.resolve(PUSH_OUTCOMES.GONE);
    if (this.failing.includes(token)) return Promise.resolve(PUSH_OUTCOMES.FAILED);

    this.sent.push({ token, payload });
    return Promise.resolve(PUSH_OUTCOMES.SENT);
  }
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

/** The live ranking as its consumers see it. Postgres counts it, so a test fills the map in. */
export class FakeLeaderboard implements Pick<
  LeaderboardService,
  'standing' | 'standingsOfStudent'
> {
  readonly standings = new Map<string, FakeStanding>();

  constructor(standings: readonly FakeStanding[] = []) {
    for (const standing of standings) this.standings.set(standing.attemptId, standing);
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

  readonly otpSends: string[] = [];

  readonly queueFailures: { queue: string; spent: boolean }[] = [];

  countSubmit(outcome: string): void {
    this.submits.push(outcome);
  }

  countOtpSend(outcome: string): void {
    this.otpSends.push(outcome);
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
