import {
  plainTextOf,
  type LocalizedContent,
  type QuestionDetail,
  type QuestionLanguage,
  type QuestionSummary,
} from '@iace/contracts';
import { Prisma } from '@prisma/client';
import { answerKeyIn, optionsIn } from '../common/prisma-json';
import { OPEN_ASSIGNMENT, languagesIn, stemPreviewOf } from './question-core';
import { type ExportedQuestion } from './question-export';

export const QUESTION_INCLUDE = {
  subject: { select: { id: true, name: true } },
  topic: { select: { id: true, name: true } },
  // The relation, not a second lookup: a page of questions names its authors in one round trip.
  createdBy: { select: { id: true, fullName: true, email: true } },
  // The assignment it was typed under, so a work record can name the test without a second query.
  assignment: {
    select: {
      testId: true,
      baseConfigSectionId: true,
      // With the offer stamp and one open job: together they are `SECTION_WORK_IN_PROGRESS`, read off the row.
      test: {
        select: {
          title: true,
          finalizedAt: true,
          assignments: { where: OPEN_ASSIGNMENT, take: 1, select: { id: true } },
        },
      },
      baseConfigSection: { select: { name: true } },
    },
  },
  currentVersion: true,
  // One row each answers "in use"; a `_count` here grouped both whole tables on every page.
  paperQuestions: { take: 1, select: { id: true } },
  questionStats: { take: 1, select: { testId: true } },
} as const satisfies Prisma.QuestionInclude;

export type QuestionRow = Prisma.QuestionGetPayload<{ include: typeof QUESTION_INCLUDE }>;

export const QUESTION_EXPORT_SELECT = {
  questionCode: true,
  type: true,
  difficulty: true,
  status: true,
  tags: true,
  createdAt: true,
  subject: { select: { name: true } },
  topic: { select: { name: true } },
  createdBy: { select: { fullName: true, email: true } },
  currentVersion: { select: { content: true, options: true, answerKey: true } },
} as const satisfies Prisma.QuestionSelect;

export type QuestionExportRow = Prisma.QuestionGetPayload<{
  select: typeof QUESTION_EXPORT_SELECT;
}>;

/** The one part of a row the content readers need, so a lean export row reads the same way. */
type WithVersion = Pick<QuestionExportRow, 'currentVersion'>;

/** Every question starts at 1; `update` counts up from the current version. */
export const FIRST_VERSION = 1;

export function toSummary(row: QuestionRow): QuestionSummary {
  const content = contentOf(row);

  return {
    id: row.id,
    questionCode: row.questionCode,
    type: row.type,
    difficulty: row.difficulty,
    status: row.status,
    subject: row.subject,
    topic: row.topic,
    stemPreview: stemPreviewOf(content),
    languages: languagesInContent(content),
    tags: row.tags,
    author: row.createdBy
      ? { id: row.createdBy.id, name: row.createdBy.fullName ?? row.createdBy.email }
      : null,
    inUse: isReferenced(row),
    writtenFor: row.assignment
      ? {
          testId: row.assignment.testId,
          testTitle: row.assignment.test.title,
          baseConfigSectionId: row.assignment.baseConfigSectionId,
          sectionName: row.assignment.baseConfigSection.name,
          inProgress:
            row.assignment.test.finalizedAt === null && row.assignment.test.assignments.length > 0,
        }
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** What the lifecycle turns on, said once for the screen as well as for the rules. */
function isReferenced(row: QuestionRow): boolean {
  return row.paperQuestions.length + row.questionStats.length > 0;
}

export function toDetail(row: QuestionRow): QuestionDetail {
  return {
    ...toSummary(row),
    version: row.currentVersion?.version ?? FIRST_VERSION,
    content: contentOf(row),
    options: optionsIn(row.currentVersion?.options),
    answerKey: answerKeyIn(row.currentVersion?.answerKey),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toExported(row: QuestionExportRow): ExportedQuestion {
  return {
    questionCode: row.questionCode,
    type: row.type,
    difficulty: row.difficulty,
    status: row.status,
    tags: row.tags,
    subject: row.subject.name,
    topic: row.topic?.name ?? null,
    author: row.createdBy ? (row.createdBy.fullName ?? row.createdBy.email) : null,
    createdAt: row.createdAt,
    content: contentOf(row),
    options: optionsIn(row.currentVersion?.options),
    answerKey: answerKeyIn(row.currentVersion?.answerKey),
  };
}

/** A question with no current version has nothing to show — an empty content map, not a crash. */
export function contentOf(row: WithVersion): LocalizedContent {
  return (row.currentVersion?.content as LocalizedContent | undefined) ?? {};
}

/** Which languages the stored row really carries — the same rule `buildContent` applied. */
function languagesInContent(content: LocalizedContent): QuestionLanguage[] {
  const stems: Record<string, string> = {};
  for (const [language, field] of Object.entries(content)) {
    stems[language] = plainTextOf(field?.stem);
  }
  return languagesIn(stems);
}
