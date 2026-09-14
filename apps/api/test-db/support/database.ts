/**
 * Fixtures for the database tier. Each builder inserts the fewest rows a real Postgres accepts,
 * under ids no other file or run shares. A test that reads only its own rows needs nothing more;
 * one that reads what it did not write — a list total, a sweep — calls resetDatabase first.
 */
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  ATTEMPT_STATUS,
  BRANCH_TYPE,
  DEFAULT_EXAM_COURSE,
  DIFFICULTY_LEVEL,
  STUDENT_TYPE,
  type AttemptStatus,
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
  title?: string;
}

export interface StudentOverrides {
  id?: string;
  mobile?: string;
  fullName?: string | null;
  currentBranchId?: string | null;
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

export function makeAdmin(prisma: PrismaService): Promise<{ id: string }> {
  return prisma.admin.create({
    data: { id: uid('admin'), email: `${uid('admin')}@iace.test`, fullName: 'Database Tier Admin' },
    select: { id: true },
  });
}

export function makeSubject(prisma: PrismaService, name = uid('Subject')): Promise<{ id: string }> {
  return prisma.subject.create({ data: { id: uid('subject'), name }, select: { id: true } });
}

/** A question with one version, pointed at as current — the order the composite FK demands. */
export async function makeQuestion(
  prisma: PrismaService,
  input: { subjectId: string; stem?: string },
): Promise<{ id: string; versionId: string }> {
  const question = await prisma.question.create({
    data: { id: uid('question'), subjectId: input.subjectId, difficulty: DIFFICULTY_LEVEL.MEDIUM },
    select: { id: true },
  });
  const version = await prisma.questionVersion.create({
    data: {
      id: uid('version'),
      questionId: question.id,
      version: 1,
      content: { en: { stem: [{ type: 'TEXT', text: `<p>${input.stem ?? 'Stem'}</p>` }] } },
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
