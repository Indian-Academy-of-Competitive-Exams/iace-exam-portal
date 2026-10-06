/**
 * What a report's pickers offer. Its own read, behind REPORTS alone: borrowing each list's route
 * would make asking for a report need every other feature's grant as well.
 */
import {
  AppException,
  ATTEMPT_STATUS,
  ErrorCodes,
  REPORT_PARAMS,
  sittingLabel,
  studentListQuerySchema,
  type Paginated,
  type ReportChoice,
  type ReportChoiceParam,
  type ReportChoicesQuery,
} from '@iace/contracts';
import { pageArgs, paged } from '../common/pagination';
import { type PrismaService } from '../prisma/prisma.service';
import { studentWhere } from '../students';

type Choices = (
  prisma: PrismaService,
  query: ReportChoicesQuery,
) => Promise<[ReportChoice[], number]>;

const named = (q: string | undefined) =>
  q ? { contains: q, mode: 'insensitive' as const } : undefined;

const NEWEST = { sort: 'desc', nulls: 'last' } as const;

const CHOICES: Record<ReportChoiceParam, Choices> = {
  [REPORT_PARAMS.TEST]: async (prisma, query) => {
    const where = { title: named(query.q) };
    const [rows, total] = await Promise.all([
      prisma.test.findMany({
        where,
        orderBy: [{ opensAt: NEWEST }, { createdAt: 'desc' }],
        ...pageArgs(query),
        select: { id: true, title: true, testSeries: { select: { name: true } } },
      }),
      prisma.test.count({ where }),
    ]);
    const choices = rows.map((test) => ({
      value: test.id,
      label: test.title ?? 'Untitled test',
      hint: test.testSeries.name,
    }));
    return [choices, total];
  },

  [REPORT_PARAMS.STUDENT]: async (prisma, query) => {
    const where = studentWhere(studentListQuerySchema.parse({ q: query.q }));
    const [rows, total] = await Promise.all([
      prisma.student.findMany({
        where,
        orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
        ...pageArgs(query),
        select: { id: true, fullName: true, mobile: true },
      }),
      prisma.student.count({ where }),
    ]);
    const choices = rows.map((student) => ({
      value: student.id,
      label: student.fullName ?? student.mobile,
      hint: student.mobile,
    }));
    return [choices, total];
  },

  /** Marked sittings only, newest first: a score card is of a sitting that has one. */
  [REPORT_PARAMS.ATTEMPT]: async (prisma, query) => {
    if (query.studentId === undefined) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'Choose a student first', {
        fieldErrors: { studentId: ['Required'] },
      });
    }
    const where = {
      studentId: query.studentId,
      status: ATTEMPT_STATUS.EVALUATED,
      test: { title: named(query.q) },
    };
    const [rows, total] = await Promise.all([
      prisma.attempt.findMany({
        where,
        orderBy: [{ submittedAt: NEWEST }, { id: 'desc' }],
        ...pageArgs(query),
        select: {
          id: true,
          isGraded: true,
          submittedAt: true,
          test: { select: { title: true } },
        },
      }),
      prisma.attempt.count({ where }),
    ]);
    const choices = rows.map((sitting) => ({
      value: sitting.id,
      label: sittingLabel({
        testTitle: sitting.test.title,
        submittedAt: sitting.submittedAt?.toISOString() ?? null,
      }),
      hint: sitting.isGraded ? null : 'Retake',
    }));
    return [choices, total];
  },

  [REPORT_PARAMS.SERIES]: async (prisma, query) => {
    const where = { name: named(query.q) };
    const [rows, total] = await Promise.all([
      prisma.testSeries.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...pageArgs(query),
        select: { id: true, name: true },
      }),
      prisma.testSeries.count({ where }),
    ]);
    return [rows.map((series) => ({ value: series.id, label: series.name, hint: null })), total];
  },

  [REPORT_PARAMS.EVENT]: async (prisma, query) => {
    const where = { name: named(query.q) };
    const [rows, total] = await Promise.all([
      prisma.event.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...pageArgs(query),
        select: { id: true, name: true },
      }),
      prisma.event.count({ where }),
    ]);
    return [rows.map((event) => ({ value: event.id, label: event.name, hint: null })), total];
  },

  [REPORT_PARAMS.BRANCH]: async (prisma, query) => {
    const where = { name: named(query.q) };
    const [rows, total] = await Promise.all([
      prisma.branch.findMany({
        where,
        orderBy: { name: 'asc' },
        ...pageArgs(query),
        select: { id: true, name: true },
      }),
      prisma.branch.count({ where }),
    ]);
    return [rows.map((branch) => ({ value: branch.id, label: branch.name, hint: null })), total];
  },
};

export async function reportChoices(
  prisma: PrismaService,
  param: ReportChoiceParam,
  query: ReportChoicesQuery,
): Promise<Paginated<ReportChoice>> {
  const [items, total] = await CHOICES[param](prisma, query);
  return paged(query, items, total);
}
