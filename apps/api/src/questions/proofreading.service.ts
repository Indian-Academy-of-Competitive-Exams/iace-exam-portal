import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  QUESTION_FLAG_STATUS,
  QUESTION_STATUS,
  type CreateQuestionFlagBody,
  type Paginated,
  type ProofreadQuestion,
  type QuestionFlag,
  type QuestionFlagActor,
  type QuestionListQuery,
  type SettleQuestionFlagBody,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { QuestionsService } from './questions.service';

const FLAG_SELECT = {
  id: true,
  questionId: true,
  versionId: true,
  category: true,
  comment: true,
  status: true,
  raisedById: true,
  resolvedById: true,
  resolvedAt: true,
  createdAt: true,
} as const satisfies Prisma.QuestionFlagSelect;

type FlagRow = Prisma.QuestionFlagGetPayload<{ select: typeof FLAG_SELECT }>;

/** Postgres sorts an enum in its declared order, and OPEN is declared first — unsettled at the top. */
const FLAG_ORDER: Prisma.QuestionFlagOrderByWithRelationInput[] = [
  { status: 'asc' },
  { createdAt: 'desc' },
];

/** Owns `QuestionFlag` (docs/03 §5). The document itself is the question bank's own page. */
@Injectable()
export class ProofreadingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly questions: QuestionsService,
  ) {}

  /** A filtered selection, read top to bottom: every question in full, with what has been said about it. */
  async document(query: QuestionListQuery): Promise<Paginated<ProofreadQuestion>> {
    // Forced, not filtered: proof-reading gates ACTIVATION, so a live question is past reading (§11).
    const page = await this.questions.page(query, { status: QUESTION_STATUS.DRAFT });
    const ids = page.items.map((question) => question.id);

    const [rows, versions] = await Promise.all([
      this.prisma.questionFlag.findMany({
        where: { questionId: { in: ids } },
        select: FLAG_SELECT,
        orderBy: FLAG_ORDER,
      }),
      this.prisma.question.findMany({
        where: { id: { in: ids } },
        select: { id: true, currentVersionId: true },
      }),
    ]);
    const actors = await this.actorsOf(rows);
    const current = new Map(versions.map((row) => [row.id, row.currentVersionId]));

    const byQuestion = new Map<string, QuestionFlag[]>();
    for (const row of rows) {
      const flags = byQuestion.get(row.questionId) ?? [];
      flags.push(toFlag(row, actors, current.get(row.questionId) ?? null));
      byQuestion.set(row.questionId, flags);
    }

    return {
      ...page,
      items: page.items.map((question) => ({
        ...question,
        flags: byQuestion.get(question.id) ?? [],
      })),
    };
  }

  /** The version is the server's: it is the one the reader was served, not one the client names. */
  async raise(
    questionId: string,
    body: CreateQuestionFlagBody,
    raisedById: string,
  ): Promise<QuestionFlag> {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: { currentVersionId: true },
    });
    if (!question) throw new AppException(ErrorCodes.NOT_FOUND, 'No such question');

    const row = await this.prisma.questionFlag.create({
      data: {
        questionId,
        versionId: question.currentVersionId,
        category: body.category,
        comment: body.comment,
        raisedById,
      },
      select: FLAG_SELECT,
    });

    return toFlag(row, await this.actorsOf([row]), question.currentVersionId);
  }

  /** Resolved or dismissed, both settlements: nothing reopens, and no status moves on its own. */
  async settle(
    flagId: string,
    body: SettleQuestionFlagBody,
    resolvedById: string,
  ): Promise<QuestionFlag> {
    const settled = await this.prisma.questionFlag.updateMany({
      where: { id: flagId, status: QUESTION_FLAG_STATUS.OPEN },
      data: { status: body.status, resolvedById, resolvedAt: new Date() },
    });

    const row = await this.prisma.questionFlag.findUnique({
      where: { id: flagId },
      select: { ...FLAG_SELECT, question: { select: { currentVersionId: true } } },
    });
    if (!row) throw new AppException(ErrorCodes.NOT_FOUND, 'No such flag');
    if (settled.count !== 1) throw alreadySettled();

    return toFlag(row, await this.actorsOf([row]), row.question.currentVersionId);
  }

  /** Admin ids are scalar on the flag, so the names come back in one lookup for the whole page. */
  private async actorsOf(rows: FlagRow[]): Promise<Map<string, QuestionFlagActor>> {
    const ids = [
      ...new Set(rows.flatMap((row) => [row.raisedById, row.resolvedById ?? []].flat())),
    ];
    if (ids.length === 0) return new Map();

    const admins = await this.prisma.admin.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true, email: true },
    });
    return new Map(
      admins.map((admin) => [admin.id, { id: admin.id, name: admin.fullName ?? admin.email }]),
    );
  }
}

function toFlag(
  row: FlagRow,
  actors: ReadonlyMap<string, QuestionFlagActor>,
  currentVersionId: string | null,
): QuestionFlag {
  return {
    id: row.id,
    questionId: row.questionId,
    category: row.category,
    comment: row.comment,
    status: row.status,
    raisedBy: actors.get(row.raisedById) ?? null,
    resolvedBy: row.resolvedById ? (actors.get(row.resolvedById) ?? null) : null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    // A flag raised before an edit stays legible as one raised against what the reviewer read.
    onCurrentVersion: row.versionId === null || row.versionId === currentVersionId,
    createdAt: row.createdAt.toISOString(),
  };
}

const alreadySettled = () =>
  new AppException(
    ErrorCodes.CONFLICT,
    'Somebody else has already settled this flag. Open the document again.',
    { fieldErrors: { status: ['This flag is no longer open'] } },
  );
