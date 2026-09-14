/**
 * Fixtures for the database tier. Each builder inserts the fewest rows a real Postgres accepts,
 * under ids no other file or run shares. A test that reads only its own rows needs nothing more;
 * one that reads what it did not write — a list total, a sweep — calls resetDatabase first.
 */
import { randomUUID } from 'node:crypto';
import { Prisma, type DeliveryChannel } from '@prisma/client';
import {
  ATTEMPT_STATUS,
  BRANCH_TYPE,
  DEFAULT_EXAM_COURSE,
  DIFFICULTY_LEVEL,
  NOTIFICATION_TYPE,
  STUDENT_TYPE,
  TEST_SCOPE,
  type AttemptStatus,
  type DifficultyLevel,
  type QuestionStatus,
  type TestScope,
  type TestStatus,
} from '@iace/contracts';
import { PrismaService } from '../../src/prisma/prisma.service';

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HALF_HOUR_SEC = 30 * 60;

export interface Catalog {
  examStageId: string;
  baseConfigId: string;
  testSeriesId: string;
}

export interface TestOverrides {
  title?: string | null;
  status?: TestStatus;
  opensAt?: Date | null;
  scope?: TestScope;
}

export interface StudentOverrides {
  id?: string;
  mobile?: string;
  fullName?: string | null;
  currentBranchId?: string | null;
  programs?: string[];
  isActive?: boolean;
  isTestBlocked?: boolean;
  deletedAt?: Date | null;
  anonymizedAt?: Date | null;
}

export interface SittingInput {
  testId: string;
  studentId: string;
  score: number;
  isGraded?: boolean;
  status?: AttemptStatus;
  attemptNo?: number;
  submittedAt?: Date;
  timeTakenSec?: number;
  createdAt?: Date;
}

/** Run any other way, Prisma falls back to `.env` and the dev database. */
export function testPrisma(): PrismaService {
  const url = process.env.DATABASE_URL;
  if (!url || url !== process.env.TEST_DATABASE_URL) {
    throw new Error(
      'The database tests run through `pnpm test:db`, against TEST_DATABASE_URL only.',
    );
  }
  return new PrismaService();
}

export const uid = (prefix: string): string => `${prefix}_${randomUUID()}`;

let emptyEveryTable: Prisma.Sql | undefined;

/** Every table but the migration ledger, read from the catalog so a new table needs no edit here. */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  emptyEveryTable ??= await truncateStatement(prisma);
  await prisma.$transaction([
    // The locked-config guard refuses TRUNCATE by design; replica mode stands it down for this transaction.
    prisma.$executeRaw`SET LOCAL session_replication_role = replica`,
    prisma.$executeRaw(emptyEveryTable),
  ]);
}

async function truncateStatement(prisma: PrismaService): Promise<Prisma.Sql> {
  const tables = await prisma.$queryRaw<{ name: string }[]>`
    SELECT tablename AS name FROM pg_tables
    WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`;
  return Prisma.raw(`TRUNCATE ${tables.map((row) => `"${row.name}"`).join(', ')} CASCADE`);
}

export async function makeCatalog(prisma: PrismaService): Promise<Catalog> {
  const exam = await prisma.exam.create({
    data: {
      id: uid('exam'),
      course: DEFAULT_EXAM_COURSE,
      code: uid('EXAM'),
      name: 'Database tier exam',
    },
    select: { id: true },
  });
  const stage = await prisma.examStage.create({
    data: { id: uid('stage'), examId: exam.id, stageKey: uid('stage'), name: 'Tier 1' },
    select: { id: true },
  });
  const config = await prisma.baseConfig.create({
    data: {
      id: uid('config'),
      examStageId: stage.id,
      name: 'Database tier pattern',
      totalQuestions: 100,
      totalMarks: 200,
      durationSec: 3600,
    },
    select: { id: true },
  });
  const series = await prisma.testSeries.create({
    data: { id: uid('series'), name: uid('Database tier series'), examStageId: stage.id },
    select: { id: true },
  });
  return { examStageId: stage.id, baseConfigId: config.id, testSeriesId: series.id };
}

/** A stage on an exam of its own, with no config or series beside it. */
export async function makeStage(prisma: PrismaService, isActive = true): Promise<string> {
  const exam = await prisma.exam.create({
    data: { id: uid('exam'), course: DEFAULT_EXAM_COURSE, code: uid('EXAM'), name: 'SSC CGL' },
    select: { id: true },
  });
  const stage = await prisma.examStage.create({
    data: { id: uid('stage'), examId: exam.id, stageKey: uid('STAGE'), name: 'Tier 1', isActive },
    select: { id: true },
  });
  return stage.id;
}

export function makeTest(
  prisma: PrismaService,
  catalog: Catalog,
  overrides: TestOverrides = {},
): Promise<{ id: string }> {
  return prisma.test.create({
    data: {
      id: uid('test'),
      title: uid('Database tier mock'),
      baseConfigId: catalog.baseConfigId,
      examStageId: catalog.examStageId,
      testSeriesId: catalog.testSeriesId,
      ...overrides,
    },
    select: { id: true },
  });
}

export function makeStudent(
  prisma: PrismaService,
  overrides: StudentOverrides = {},
): Promise<{ id: string }> {
  return prisma.student.create({
    data: {
      id: uid('student'),
      mobile: uid('mobile'),
      studentType: STUDENT_TYPE.ONLINE,
      fullName: 'Database Tier Student',
      ...overrides,
    },
    select: { id: true },
  });
}

export function makeBranch(prisma: PrismaService, name = uid('Branch')): Promise<{ id: string }> {
  return prisma.branch.create({
    data: { id: uid('branch'), name, type: BRANCH_TYPE.PHYSICAL },
    select: { id: true },
  });
}

export interface AdminOverrides {
  email?: string;
  fullName?: string | null;
  isSuperAdmin?: boolean;
  isActive?: boolean;
}

export function makeAdmin(
  prisma: PrismaService,
  overrides: AdminOverrides = {},
): Promise<{ id: string }> {
  return prisma.admin.create({
    data: {
      id: uid('admin'),
      email: `${uid('admin')}@iace.test`,
      fullName: 'Database Tier Admin',
      ...overrides,
    },
    select: { id: true },
  });
}

export function makeNotification(
  prisma: PrismaService,
  input: { studentId: string; isRead?: boolean; createdAt?: Date; title?: string },
): Promise<{ id: string }> {
  return prisma.notification.create({
    data: {
      id: uid('notification'),
      studentId: input.studentId,
      type: NOTIFICATION_TYPE.GENERIC,
      title: input.title ?? 'Something happened',
      isRead: input.isRead ?? false,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
    select: { id: true },
  });
}

/** An announcement sent by an admin of its own, choosing the channels its messages fall back through. */
export async function makeAnnouncement(
  prisma: PrismaService,
  paidChannels: DeliveryChannel[] = [],
): Promise<{ id: string }> {
  const admin = await makeAdmin(prisma);
  return prisma.announcement.create({
    data: {
      id: uid('announcement'),
      title: 'Branch closed tomorrow',
      body: 'The Ameerpet centre is shut on Friday.',
      audience: {},
      paidChannels,
      recipientCount: 1,
      estimatedCostPaise: 0,
      createdById: admin.id,
    },
    select: { id: true },
  });
}

export function makeSubject(prisma: PrismaService, name = uid('Subject')): Promise<{ id: string }> {
  return prisma.subject.create({ data: { id: uid('subject'), name }, select: { id: true } });
}

/** A question with one version, pointed at as current — the order the composite FK demands. */
export async function makeQuestion(
  prisma: PrismaService,
  input: {
    subjectId: string;
    stem?: string;
    status?: QuestionStatus;
    difficulty?: DifficultyLevel;
    options?: Prisma.InputJsonValue;
  },
): Promise<{ id: string; versionId: string }> {
  const question = await prisma.question.create({
    data: {
      id: uid('question'),
      subjectId: input.subjectId,
      difficulty: input.difficulty ?? DIFFICULTY_LEVEL.MEDIUM,
      ...(input.status ? { status: input.status } : {}),
    },
    select: { id: true },
  });
  const version = await prisma.questionVersion.create({
    data: {
      id: uid('version'),
      questionId: question.id,
      version: 1,
      content: { en: { stem: [{ type: 'TEXT', text: `<p>${input.stem ?? 'Stem'}</p>` }] } },
      ...(input.options === undefined ? {} : { options: input.options }),
    },
    select: { id: true },
  });
  await prisma.question.update({
    where: { id: question.id },
    data: { currentVersionId: version.id },
  });
  return { id: question.id, versionId: version.id };
}

export function makeSection(prisma: PrismaService, catalog: Catalog): Promise<{ id: string }> {
  return prisma.baseConfigSection.create({
    data: {
      id: uid('section'),
      baseConfigId: catalog.baseConfigId,
      name: 'Database tier section',
      order: 1,
      questionCount: 10,
      marksPerQuestion: 2,
      negativeMarks: 0.5,
    },
    select: { id: true },
  });
}

/** The option a paper question is keyed to; the other three are wrong. */
export const RIGHT_OPTION = 'o1';

/** Four options with `o1` right — the shape a version's `options` column holds. */
export const fourOptions = (): Prisma.InputJsonValue =>
  Array.from({ length: 4 }, (_, index) => ({
    id: `o${index + 1}`,
    position: index + 1,
    isCorrect: index === 0,
    text: { en: [{ type: 'TEXT', text: `Option ${index + 1}` }] },
  }));

export interface PaperItem {
  paperQuestionId: string;
  questionId: string;
  versionId: string;
  subjectId: string;
}

export interface Paper {
  testId: string;
  scope: TestScope;
  sectionId: string;
  items: PaperItem[];
}

/** A test with a real paper: one section, one question per subject named, each worth 2 with 0.5 off. */
export async function makePaper(
  prisma: PrismaService,
  input: { subjects: readonly string[]; scope?: TestScope; catalog?: Catalog },
): Promise<Paper> {
  const catalog = input.catalog ?? (await makeCatalog(prisma));
  const scope = input.scope ?? TEST_SCOPE.FULL;
  const test = await makeTest(prisma, catalog, { scope });
  const section = await makeSection(prisma, catalog);
  const items: PaperItem[] = [];
  for (const [index, name] of input.subjects.entries()) {
    const subject = await prisma.subject.upsert({
      where: { name },
      create: { id: uid('subject'), name },
      update: {},
      select: { id: true },
    });
    const question = await makeQuestion(prisma, { subjectId: subject.id, options: fourOptions() });
    const paperQuestion = await prisma.paperQuestion.create({
      data: {
        id: uid('pq'),
        testId: test.id,
        baseConfigId: catalog.baseConfigId,
        baseConfigSectionId: section.id,
        questionId: question.id,
        questionVersionId: question.versionId,
        order: index + 1,
        marks: 2,
        negativeMarks: 0.5,
      },
      select: { id: true },
    });
    items.push({
      paperQuestionId: paperQuestion.id,
      questionId: question.id,
      versionId: question.versionId,
      subjectId: subject.id,
    });
  }
  return { testId: test.id, scope, sectionId: section.id, items };
}

export interface SitInput {
  paper: Paper;
  studentId: string;
  /** One choice per paper question, in order; null leaves it untouched. */
  chosen: readonly (string | null)[];
  attemptNo?: number;
  isGraded?: boolean;
  submittedAt?: Date;
}

/** A submitted, not-yet-scored sitting served the whole paper, thirty seconds on each question. */
export async function sitPaper(prisma: PrismaService, input: SitInput): Promise<{ id: string }> {
  const submittedAt = input.submittedAt ?? new Date('2026-08-24T05:00:00.000Z');
  const startedAt = new Date(submittedAt.getTime() - HALF_HOUR_SEC * SECOND_MS);
  const attempt = await prisma.attempt.create({
    data: {
      id: uid('attempt'),
      testId: input.paper.testId,
      studentId: input.studentId,
      attemptNo: input.attemptNo ?? 1,
      isGraded: input.isGraded ?? true,
      status: ATTEMPT_STATUS.SUBMITTED,
      startedAt,
      endsAt: new Date(startedAt.getTime() + 60 * MINUTE_MS),
      submittedAt,
      shuffleSeed: 7,
    },
    select: { id: true },
  });
  await prisma.attemptQuestion.createMany({
    data: input.paper.items.map((item, index) => ({
      attemptId: attempt.id,
      questionId: item.questionId,
      questionVersionId: item.versionId,
      paperQuestionId: item.paperQuestionId,
      baseConfigSectionId: input.paper.sectionId,
      order: index + 1,
      selectedOptionId: input.chosen[index] ?? null,
      timeSpentSec: 30,
    })),
  });
  return attempt;
}

/** One question as a sitting was served it, with the seconds spent on it. */
export function serveQuestion(
  prisma: PrismaService,
  input: {
    attemptId: string;
    question: { id: string; versionId: string };
    sectionId: string;
    order?: number;
    timeSpentSec?: number;
  },
): Promise<unknown> {
  return prisma.attemptQuestion.create({
    data: {
      attemptId: input.attemptId,
      questionId: input.question.id,
      questionVersionId: input.question.versionId,
      baseConfigSectionId: input.sectionId,
      order: input.order ?? 1,
      timeSpentSec: input.timeSpentSec ?? 0,
    },
  });
}

/** An evaluated, graded first sitting unless told otherwise, submitted half an hour in. */
export function makeSitting(prisma: PrismaService, input: SittingInput): Promise<{ id: string }> {
  const submittedAt = input.submittedAt ?? new Date();
  const timeTakenSec = input.timeTakenSec ?? HALF_HOUR_SEC;
  const startedAt = new Date(submittedAt.getTime() - timeTakenSec * SECOND_MS);
  return prisma.attempt.create({
    data: {
      id: uid('attempt'),
      testId: input.testId,
      studentId: input.studentId,
      attemptNo: input.attemptNo ?? 1,
      isGraded: input.isGraded ?? true,
      status: input.status ?? ATTEMPT_STATUS.EVALUATED,
      startedAt,
      endsAt: new Date(startedAt.getTime() + 60 * MINUTE_MS),
      submittedAt,
      evaluatedAt: submittedAt,
      shuffleSeed: 1,
      score: input.score,
      timeTakenSec,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
    select: { id: true },
  });
}
