import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  AUTHORING_HISTORY_DAYS,
  AUTHORING_TAG_SUGGESTIONS,
  ErrorCodes,
  INSTITUTE_TIME_ZONE,
  QUESTION_STATUSES,
  QUESTION_SORTS,
  todayISO,
  type AuthoringHistoryQuery,
  type AuthoringSaveResult,
  type AuthoringStats,
  type Paginated,
  type QuestionDraft,
  type QuestionListQuery,
  type QuestionSummary,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { shiftInstituteDay, startOfInstituteDay } from '../common/time/institute-day';
import { computeStemHash } from './question-core';
import { writtenBetween } from './question-query';
import { QuestionsService } from './questions.service';

/** Every read and write fenced to the author, over the one service that owns the two tables. */
@Injectable()
export class AuthoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly questions: QuestionsService,
  ) {}

  /** Straight into the bank; a section's question is typed on its section page. */
  async create(draft: QuestionDraft, adminId: string): Promise<AuthoringSaveResult> {
    const question = await this.questions.create(draft, adminId);
    return { question };
  }

  async update(id: string, draft: QuestionDraft, adminId: string): Promise<AuthoringSaveResult> {
    assertLoose(await this.assertTheirs(id, adminId));
    const question = await this.questions.update(id, draft, adminId);
    return { question };
  }

  async detail(id: string, adminId: string) {
    await this.assertTheirs(id, adminId);
    return this.questions.detail(id);
  }

  /** A typist's own mistake, taken back the moment they see it — the bank never hears about it. */
  async remove(id: string, adminId: string, isSuperAdmin = false): Promise<void> {
    const row = await this.prisma.question.findFirst({
      where: { id, ...(isSuperAdmin ? {} : { createdById: adminId }) },
      select: { assignment: { select: { testId: true, baseConfigSectionId: true } } },
    });
    if (!row) throw new AppException(ErrorCodes.NOT_FOUND, 'No such question');
    assertLoose(row.assignment);
    await this.questions.remove(id);
  }

  history(query: AuthoringHistoryQuery, adminId: string): Promise<Paginated<QuestionSummary>> {
    return this.questions.list(asBankQuery(query), {
      createdById: adminId,
      ...(query.assignmentId?.length ? { assignmentId: { in: query.assignmentId } } : {}),
      ...(query.testId ? { assignment: { testId: query.testId } } : {}),
      ...(query.from || query.to ? { createdAt: writtenBetween(query.from, query.to) } : {}),
    });
  }

  async stats(adminId: string): Promise<AuthoringStats> {
    const today = todayISO();
    const firstDay = shiftInstituteDay(today, -(AUTHORING_HISTORY_DAYS - 1));
    const mine: Prisma.QuestionWhereInput = { createdById: adminId };

    const [total, byStatusRows, inReview, counted] = await Promise.all([
      this.prisma.question.count({ where: mine }),
      this.prisma.question.groupBy({ by: ['status'], where: mine, _count: true }),
      this.prisma.question.count({ where: { ...mine, assignment: { finalizedAt: null } } }),
      this.countByDay(adminId, firstDay),
    ]);

    const byStatus = Object.fromEntries(byStatusRows.map((row) => [row.status, row._count]));
    const daily = everyDayFrom(firstDay, today).map((date) => ({
      date,
      count: counted.get(date) ?? 0,
    }));
    const lastSeven = daily.slice(-SEVEN_DAYS);

    return {
      today: counted.get(today) ?? 0,
      lastSevenDays: lastSeven.reduce((sum, day) => sum + day.count, 0),
      total,
      inReview,
      byStatus,
      daily,
    };
  }

  /** The author's own tags, the most recently used first — what the header offers as they type. */
  async tags(adminId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ tag: string }[]>`
      SELECT tag FROM (
        SELECT unnest(q."tags") AS tag, MAX(q."updatedAt") AS last_used
        FROM "Question" q
        WHERE q."createdById" = ${adminId}::uuid
        GROUP BY 1
      ) used
      ORDER BY last_used DESC
      LIMIT ${AUTHORING_TAG_SUGGESTIONS}
    `;
    return rows.map((row) => row.tag);
  }

  /** Grouped in the database at the institute's day boundary, never at UTC midnight. */
  private async countByDay(adminId: string, firstDay: string): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<{ day: string; written: bigint }[]>`
      SELECT to_char((q."createdAt" AT TIME ZONE ${INSTITUTE_TIME_ZONE})::date, 'YYYY-MM-DD') AS day,
             COUNT(*) AS written
      FROM "Question" q
      WHERE q."createdById" = ${adminId}::uuid AND q."createdAt" >= ${startOfInstituteDay(firstDay)}
      GROUP BY 1
    `;
    return new Map(rows.map((row) => [row.day, Number(row.written)]));
  }

  /** Asked while the question is typed; the save itself refuses one. */
  async duplicateFor(draft: QuestionDraft, exceptId: string | null) {
    return this.questions.duplicateOf(computeStemHash(draft), exceptId);
  }

  /** Not theirs reads as not there: an author has no business learning what another one wrote. */
  private async assertTheirs(id: string, adminId: string): Promise<SectionRef> {
    const row = await this.prisma.question.findFirst({
      where: { id, createdById: adminId },
      select: { assignment: { select: { testId: true, baseConfigSectionId: true } } },
    });
    if (!row) throw new AppException(ErrorCodes.NOT_FOUND, 'No such question');
    return row.assignment;
  }
}

const SEVEN_DAYS = 7;

/** The section a question was written for; null for one typed straight into the bank. */
type SectionRef = { testId: string; baseConfigSectionId: string } | null;

const ON_ITS_SECTION_MESSAGE =
  "This question was written for a section, so it is changed on that section's page.";

/** A section's question has its own rules for who changes it and when, and one page that applies them. */
function assertLoose(section: SectionRef): void {
  if (section) throw new AppException(ErrorCodes.CONFLICT, ON_ITS_SECTION_MESSAGE);
}

/** Every status when the reader named none: the bank hides the archived, a work record cannot. */
function asBankQuery(query: AuthoringHistoryQuery): QuestionListQuery {
  return {
    page: query.page,
    pageSize: query.pageSize,
    q: query.q,
    // A work record is already one author's, so the bank's author filter has nothing left to ask.
    author: undefined,
    subjectId: query.subjectId,
    topicId: undefined,
    type: query.type,
    difficulty: query.difficulty,
    status: query.status ?? [...QUESTION_STATUSES],
    language: undefined,
    tag: query.tag,
    sort: QUESTION_SORTS.RECENT,
    match: query.match,
  };
}

function everyDayFrom(first: string, last: string): string[] {
  const days: string[] = [];
  for (let day = first; day <= last; day = shiftInstituteDay(day, 1)) days.push(day);
  return days;
}
