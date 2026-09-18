/**
 * Fixtures for the database tier. Each builder inserts the fewest rows a real Postgres accepts,
 * under ids no other file or run shares. A test that reads only its own rows needs nothing more;
 * one that reads what it did not write — a list total, a sweep — calls resetDatabase first.
 */
import { randomUUID } from 'node:crypto';
import { Prisma, type DeliveryChannel, type SupportedLanguage } from '@prisma/client';
import {
  ANSWER_STATE,
  ATTEMPT_STATUS,
  AUDIT_ACTION,
  AUDIT_ACTOR_TYPE,
  AUDIT_FEATURE,
  BRANCH_TYPE,
  DEFAULT_EXAM_COURSE,
  DIFFICULTY_LEVEL,
  NOTIFICATION_TYPE,
  QUESTION_STATUS,
  STUDENT_TYPE,
  TEST_SCOPE,
  type AnswerState,
  type AttemptStatus,
  type DifficultyLevel,
  type ExamCourse,
  type QuestionStatus,
  type QuestionType,
  type LiveAnswer,
  type StudentType,
  type TestScope,
  type TestStatus,
} from '@iace/contracts';
import { PrismaService } from '../../src/prisma/prisma.service';
import { sheetOf, servedSheet } from '../../src/attempts/answer-sheet';
import { SHEET_ROW_SELECT } from '../../src/attempts/paper-sheet.service';

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
  seriesOrder?: number;
}

export interface StudentOverrides {
  id?: string;
  mobile?: string;
  fullName?: string | null;
  studentType?: StudentType;
  enrolledExams?: string[];
  currentBranchId?: string | null;
  programs?: string[];
  enrolledCourses?: ExamCourse[];
  pinHash?: string;
  isActive?: boolean;
  isTestBlocked?: boolean;
  deletedAt?: Date | null;
  anonymizedAt?: Date | null;
  createdAt?: Date;
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

export const uid = (): string => randomUUID();

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
      id: uid(),
      course: DEFAULT_EXAM_COURSE,
      code: uid(),
      name: 'Database tier exam',
    },
    select: { id: true },
  });
  const stage = await prisma.examStage.create({
    data: { id: uid(), examId: exam.id, stageKey: uid(), name: 'Tier 1' },
    select: { id: true },
  });
  const config = await prisma.baseConfig.create({
    data: {
      id: uid(),
      examStageId: stage.id,
      name: 'Database tier pattern',
      totalQuestions: 100,
      totalMarks: 200,
      durationSec: 3600,
      // Deterministic order: a test naming "questions[0]" means the paper's own first row.
      shuffleQuestions: false,
    },
    select: { id: true },
  });
  const series = await prisma.testSeries.create({
    data: { id: uid(), name: uid(), examStageId: stage.id },
    select: { id: true },
  });
  return { examStageId: stage.id, baseConfigId: config.id, testSeriesId: series.id };
}

/** A stage on an exam of its own, with no config or series beside it. */
export async function makeStage(prisma: PrismaService, isActive = true): Promise<string> {
  const exam = await prisma.exam.create({
    data: { id: uid(), course: DEFAULT_EXAM_COURSE, code: uid(), name: 'SSC CGL' },
    select: { id: true },
  });
  const stage = await prisma.examStage.create({
    data: { id: uid(), examId: exam.id, stageKey: uid(), name: 'Tier 1', isActive },
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
      id: uid(),
      title: uid(),
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
      id: uid(),
      mobile: uid(),
      studentType: STUDENT_TYPE.ONLINE,
      fullName: 'Database Tier Student',
      ...overrides,
    },
    select: { id: true },
  });
}

export function makeBranch(prisma: PrismaService, name = uid()): Promise<{ id: string }> {
  return prisma.branch.create({
    data: { id: uid(), name, type: BRANCH_TYPE.PHYSICAL },
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
      id: uid(),
      email: `${uid()}@iace.test`,
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
      id: uid(),
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
      id: uid(),
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

export function makeSubject(prisma: PrismaService, name = uid()): Promise<{ id: string }> {
  return prisma.subject.create({ data: { id: uid(), name }, select: { id: true } });
}

/** A question with one version, pointed at as current — the order the composite FK demands. */
export async function makeQuestion(
  prisma: PrismaService,
  input: {
    subjectId: string;
    stem?: string;
    status?: QuestionStatus;
    difficulty?: DifficultyLevel;
    type?: QuestionType;
    options?: Prisma.InputJsonValue;
    content?: Prisma.InputJsonValue;
    answerKey?: Prisma.InputJsonValue;
  },
): Promise<{ id: string; versionId: string }> {
  const question = await prisma.question.create({
    data: {
      id: uid(),
      subjectId: input.subjectId,
      difficulty: input.difficulty ?? DIFFICULTY_LEVEL.MEDIUM,
      ...(input.status ? { status: input.status } : {}),
      ...(input.type ? { type: input.type } : {}),
    },
    select: { id: true },
  });
  const version = await prisma.questionVersion.create({
    data: {
      id: uid(),
      questionId: question.id,
      version: 1,
      content: input.content ?? {
        en: { stem: [{ type: 'TEXT', text: `<p>${input.stem ?? 'Stem'}</p>` }] },
      },
      ...(input.options === undefined ? {} : { options: input.options }),
      ...(input.answerKey === undefined ? {} : { answerKey: input.answerKey }),
    },
    select: { id: true },
  });
  await prisma.question.update({
    where: { id: question.id },
    data: { currentVersionId: version.id },
  });
  return { id: question.id, versionId: version.id };
}

export function makeSection(
  prisma: PrismaService,
  catalog: Catalog,
  input: { name?: string; order?: number } = {},
): Promise<{ id: string }> {
  return prisma.baseConfigSection.create({
    data: {
      id: uid(),
      baseConfigId: catalog.baseConfigId,
      name: input.name ?? 'Database tier section',
      order: input.order ?? 1,
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
  sectionId: string;
}

export interface Paper {
  testId: string;
  catalog: Catalog;
  scope: TestScope;
  sectionIds: string[];
  items: PaperItem[];
}

export interface PaperQuestionSpec {
  subject: string;
  /** Index into the paper's sections; the first when left out. */
  section?: number;
  stem?: string;
  difficulty?: DifficultyLevel;
  type?: QuestionType;
  options?: Prisma.InputJsonValue;
  content?: Prisma.InputJsonValue;
  answerKey?: Prisma.InputJsonValue;
}

export interface PaperInput {
  /** One question per entry — a subject name alone, or the whole question. */
  questions: readonly (string | PaperQuestionSpec)[];
  sections?: readonly string[];
  scope?: TestScope;
  catalog?: Catalog;
  title?: string;
}

/** A test with a real paper: its sections, and each question priced at 2 with 0.5 off. */
export async function makePaper(prisma: PrismaService, input: PaperInput): Promise<Paper> {
  const catalog = input.catalog ?? (await makeCatalog(prisma));
  const scope = input.scope ?? TEST_SCOPE.FULL;
  const test = await makeTest(prisma, catalog, {
    scope,
    ...(input.title ? { title: input.title } : {}),
  });
  const sectionIds: string[] = [];
  for (const [index, name] of (input.sections ?? ['Section A']).entries()) {
    sectionIds.push((await makeSection(prisma, catalog, { name, order: index + 1 })).id);
  }
  const items: PaperItem[] = [];
  for (const [index, entry] of input.questions.entries()) {
    const {
      subject: subjectName,
      section,
      ...asked
    } = typeof entry === 'string' ? { subject: entry } : entry;
    const subject = await prisma.subject.upsert({
      where: { name: subjectName },
      create: { id: uid(), name: subjectName },
      update: {},
      select: { id: true },
    });
    const question = await makeQuestion(prisma, {
      subjectId: subject.id,
      options: fourOptions(),
      ...asked,
    });
    const sectionId = sectionIds[section ?? 0] ?? sectionIds[0] ?? '';
    const paperQuestion = await prisma.paperQuestion.create({
      data: {
        id: uid(),
        testId: test.id,
        baseConfigId: catalog.baseConfigId,
        baseConfigSectionId: sectionId,
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
      sectionId,
    });
  }
  return { testId: test.id, catalog, scope, sectionIds, items };
}

export interface SitInput {
  paper: Paper;
  studentId: string;
  /** One choice per paper question, in order; null leaves it untouched. */
  chosen: readonly (string | null)[];
  /** A typed answer per question, for the ones with no options to choose. */
  typed?: readonly (string | null)[];
  /** The palette state per question; answered or not visited follows the choice when left out. */
  states?: readonly (AnswerState | undefined)[];
  /** Seconds per question; thirty each when left out. */
  timeSpent?: readonly number[];
  attemptNo?: number;
  isGraded?: boolean;
  status?: AttemptStatus;
  startedAt?: Date;
  /** Null for a sitting that never submitted. */
  submittedAt?: Date | null;
  evaluatedAt?: Date | null;
  score?: number | null;
  languages?: SupportedLanguage[];
  shuffleSeed?: number;
}

const SAT_ON = new Date('2026-08-24T05:00:00.000Z');

/** A sitting served the whole paper — submitted and unscored unless told otherwise. */
export async function sitPaper(prisma: PrismaService, input: SitInput): Promise<{ id: string }> {
  const submittedAt = input.submittedAt === undefined ? SAT_ON : input.submittedAt;
  const startedAt =
    input.startedAt ?? new Date((submittedAt ?? SAT_ON).getTime() - HALF_HOUR_SEC * SECOND_MS);
  const attempt = await prisma.attempt.create({
    data: {
      id: uid(),
      testId: input.paper.testId,
      studentId: input.studentId,
      attemptNo: input.attemptNo ?? 1,
      isGraded: input.isGraded ?? true,
      status: input.status ?? ATTEMPT_STATUS.SUBMITTED,
      startedAt,
      endsAt: new Date(startedAt.getTime() + 60 * MINUTE_MS),
      submittedAt,
      evaluatedAt: input.evaluatedAt ?? null,
      score: input.score ?? null,
      shuffleSeed: input.shuffleSeed ?? 7,
      ...(input.languages ? { languages: input.languages } : {}),
    },
    select: { id: true },
  });
  const given = input.paper.items.map((item, index) => {
    const chosen = input.chosen[index] ?? null;
    const typedAnswer = input.typed?.[index] ?? null;
    const state =
      input.states?.[index] ??
      (chosen === null && typedAnswer === null ? ANSWER_STATE.NOT_VISITED : ANSWER_STATE.ANSWERED);
    return {
      item,
      chosen,
      typedAnswer,
      state,
      timeSpentSec: input.timeSpent?.[index] ?? 30,
    };
  });
  const answers: Record<string, LiveAnswer> = Object.fromEntries(
    given.map(({ item, chosen, typedAnswer, state, timeSpentSec }) => [
      item.questionId,
      {
        state,
        selectedOptionId: chosen,
        typedAnswer,
        timeSpentSec,
        answeredAt: null,
        firstActionAt: null,
      },
    ]),
  );
  const paperRows = await prisma.paperQuestion.findMany({
    where: { testId: input.paper.testId },
    orderBy: { order: 'asc' },
    select: SHEET_ROW_SELECT,
  });
  await prisma.attemptSheet.create({
    data: { attemptId: attempt.id, answers: sheetOf(answers, paperRows, startedAt) },
  });
  return attempt;
}

/** A sitting's sheet, decoded back into one row per question, in the order it was served. */
export async function servedAnswers(prisma: PrismaService, attemptId: string) {
  const sitting = await prisma.attempt.findUniqueOrThrow({
    where: { id: attemptId },
    select: {
      testId: true,
      startedAt: true,
      shuffleSeed: true,
      sheet: { select: { answers: true, verdicts: true } },
      test: { select: { baseConfig: { select: { shuffleQuestions: true } } } },
    },
  });
  const paper = await prisma.paperQuestion.findMany({
    where: { testId: sitting.testId },
    orderBy: { order: 'asc' },
    select: { ...SHEET_ROW_SELECT, questionVersionId: true },
  });
  return servedSheet(paper, sitting, sitting.test.baseConfig.shuffleQuestions);
}

/** An evaluated, graded first sitting unless told otherwise, submitted half an hour in. */
export function makeSitting(prisma: PrismaService, input: SittingInput): Promise<{ id: string }> {
  const submittedAt = input.submittedAt ?? new Date();
  const timeTakenSec = input.timeTakenSec ?? HALF_HOUR_SEC;
  const startedAt = new Date(submittedAt.getTime() - timeTakenSec * SECOND_MS);
  return prisma.attempt.create({
    data: {
      id: uid(),
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

/** The entity and actor a row action falls back to when a test does not care which. */
export const DEFAULT_ROW_ACTION_ENTITY_ID = randomUUID();
export const DEFAULT_ROW_ACTION_ACTOR_ID = randomUUID();

/** Rows for the audit log: an admin's update of some student unless told otherwise. */
export const rowActions = (
  prisma: PrismaService,
  rows: readonly Partial<Prisma.RowActionLogCreateManyInput>[],
) =>
  prisma.rowActionLog.createMany({
    data: rows.map((row) => ({
      feature: AUDIT_FEATURE.STUDENT,
      entityId: DEFAULT_ROW_ACTION_ENTITY_ID,
      action: AUDIT_ACTION.UPDATE,
      actorType: AUDIT_ACTOR_TYPE.ADMIN,
      actorId: DEFAULT_ROW_ACTION_ACTOR_ID,
      ...row,
    })),
  });

/** Fixed ids for the suites that build a test by hand; safe only because each case resets first. */
export const BUILDER = {
  STAGE: randomUUID(),
  OTHER_STAGE: randomUUID(),
  CONFIG: randomUUID(),
  REASONING: randomUUID(),
  QUANT: randomUUID(),
} as const;

export interface BuilderSection {
  id: string;
  name: string;
  subjectId?: string;
  questionCount?: number;
}

/** Two stages of one exam, the Reasoning and Quant subjects, and one config holding the sections given. */
export async function makeBuilder(
  prisma: PrismaService,
  sections: readonly BuilderSection[],
  config: Partial<Prisma.BaseConfigUncheckedCreateInput> = {},
): Promise<void> {
  const exam = await prisma.exam.create({
    data: { id: uid(), course: DEFAULT_EXAM_COURSE, code: uid(), name: 'SSC CGL' },
    select: { id: true },
  });
  await prisma.examStage.createMany({
    data: [
      { id: BUILDER.STAGE, examId: exam.id, stageKey: uid(), name: 'Tier 1' },
      { id: BUILDER.OTHER_STAGE, examId: exam.id, stageKey: uid(), name: 'Tier 2' },
    ],
  });
  await prisma.subject.createMany({
    data: [
      { id: BUILDER.REASONING, name: 'Reasoning' },
      { id: BUILDER.QUANT, name: 'Quant' },
    ],
  });
  await prisma.baseConfig.create({
    data: {
      id: BUILDER.CONFIG,
      examStageId: BUILDER.STAGE,
      name: 'SSC CGL Tier 1 pattern',
      totalQuestions: 100,
      totalMarks: 200,
      durationSec: 3600,
      ...config,
    },
  });
  await prisma.baseConfigSection.createMany({
    data: sections.map((section, index) => ({
      id: section.id,
      baseConfigId: BUILDER.CONFIG,
      name: section.name,
      order: index + 1,
      subjectId: section.subjectId ?? null,
      questionCount: section.questionCount ?? 10,
      marksPerQuestion: 2,
      negativeMarks: 0.5,
    })),
  });
}

/** The question bank's taxonomy under fixed ids: two subjects, three topics. */
export const BANK = {
  QUANT: randomUUID(),
  GENERAL_AWARENESS: randomUUID(),
  ARITHMETIC: randomUUID(),
  ALGEBRA: randomUUID(),
  HISTORY: randomUUID(),
} as const;

/** The bank's taxonomy, and an admin per id given, named as given; only behind resetDatabase. */
export async function makeQuestionBank(
  prisma: PrismaService,
  admins: Readonly<Record<string, string>> = {},
): Promise<void> {
  await prisma.subject.createMany({
    data: [
      { id: BANK.QUANT, name: 'QUANTITATIVE APTITUDE' },
      { id: BANK.GENERAL_AWARENESS, name: 'GENERAL AWARENESS' },
    ],
  });
  await prisma.topic.createMany({
    data: [
      { id: BANK.ARITHMETIC, name: 'ARITHMETIC', subjectId: BANK.QUANT },
      { id: BANK.ALGEBRA, name: 'ALGEBRA', subjectId: BANK.QUANT },
      { id: BANK.HISTORY, name: 'HISTORY', subjectId: BANK.GENERAL_AWARENESS },
    ],
  });
  await prisma.admin.createMany({
    data: Object.entries(admins).map(([id, fullName]) => ({
      id,
      fullName,
      email: `${id}@iace.test`,
    })),
  });
}

/** A bank question under a fixed id, live with one version unless told otherwise — its id returned, since it no longer follows from the question's. */
export async function makeBankQuestion(
  prisma: PrismaService,
  input: {
    id: string;
    subjectId: string;
    topicId?: string;
    difficulty?: DifficultyLevel;
    status?: QuestionStatus;
    createdById?: string;
    versioned?: boolean;
  },
): Promise<{ versionId: string | null }> {
  const { versioned, ...question } = input;
  await prisma.question.create({
    data: {
      difficulty: DIFFICULTY_LEVEL.MEDIUM,
      status: QUESTION_STATUS.ACTIVE,
      stemHash: `hash_${input.id}`,
      ...question,
    },
  });
  if (versioned === false) return { versionId: null };
  const versionId = randomUUID();
  await prisma.questionVersion.create({
    data: {
      id: versionId,
      questionId: input.id,
      version: 1,
      content: { en: { stem: [{ type: 'TEXT', text: `<p>${input.id}</p>` }] } },
      options: fourOptions(),
    },
  });
  await prisma.question.update({
    where: { id: input.id },
    data: { currentVersionId: versionId },
  });
  return { versionId };
}
