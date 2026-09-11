/**
 * Fixtures for the database tier. Each builder inserts the fewest rows a real Postgres accepts,
 * under ids no other file or run shares. Nothing is deleted, so each test asserts on its own rows.
 */
import { randomUUID } from 'node:crypto';
import {
  ATTEMPT_STATUS,
  DEFAULT_EXAM_COURSE,
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
  fullName?: string | null;
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
    data: { id: uid('series'), name: 'Database tier series', examStageId: stage.id },
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
      title: 'Database tier mock',
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
    },
    select: { id: true },
  });
}
