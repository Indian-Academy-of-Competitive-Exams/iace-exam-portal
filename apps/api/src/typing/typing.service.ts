import { Injectable } from '@nestjs/common';
import { Prisma, type TypingPractice as PracticeRow } from '@prisma/client';
import {
  AppException,
  DEFAULT_LANGUAGE,
  ErrorCodes,
  QUESTION_STATUS,
  QUESTION_TYPE,
  TYPING_PRESETS,
  plainTextOf,
  scoreTyping,
  typingPassageNeed,
  typingPassageText,
  type FinishTypingPracticeBody,
  type LocalizedContent,
  type Paginated,
  type TypingPractice,
  type TypingPracticeListQuery,
  type TypingPracticePassage,
  type TypingPresetKey,
} from '@iace/contracts';
import { pageArgs, paged } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';

const NO_PASSAGE_MESSAGE = 'No passage is long enough for this test yet';
const PASSAGE_SELECT = { id: true, currentVersion: { select: { content: true } } } as const;
/** Where a stem's html sits in a version's content: the first node of the English stem. */
const STEM_TEXT_PATH = [DEFAULT_LANGUAGE, 'stem', '0', 'text'];
/** Drawn at random by the database and checked here, so a stem that is mostly markup has others behind it. */
const PASSAGE_CANDIDATES = 5;

type PassageRow = Prisma.QuestionGetPayload<{ select: typeof PASSAGE_SELECT }>;

/** Owns `TypingPractice` (docs/03 §5) — the only module that writes it. */
@Injectable()
export class TypingService {
  constructor(private readonly prisma: PrismaService) {}

  /** A bank passage no test holds: one written for a paper must not be met in practice first. */
  async passageFor(presetKey: TypingPresetKey): Promise<TypingPracticePassage> {
    const need = typingPassageNeed(TYPING_PRESETS[presetKey]);
    // Markup only lengthens a stem, so this never drops a passage that fits; the exact check follows.
    const drawn = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT q."id" FROM "Question" q
      JOIN "QuestionVersion" v ON v."id" = q."currentVersionId"
      WHERE q."type" = ${QUESTION_TYPE.TYPING}::"QuestionType"
        AND q."status" = ${QUESTION_STATUS.ACTIVE}::"QuestionStatus"
        AND NOT EXISTS (SELECT 1 FROM "PaperQuestion" p WHERE p."questionId" = q."id")
        AND char_length(v."content" #>> ${STEM_TEXT_PATH}::text[]) >= ${need}
      ORDER BY random()
      LIMIT ${PASSAGE_CANDIDATES}`;

    const rows = await this.prisma.question.findMany({
      where: { id: { in: drawn.map((row) => row.id) } },
      select: PASSAGE_SELECT,
    });
    const picked = rows.map(toPassage).find((passage) => passage.text.length >= need);
    if (!picked) throw new AppException(ErrorCodes.NOT_FOUND, NO_PASSAGE_MESSAGE);
    return picked;
  }

  /** Scored here from what was typed: a figure the browser sent would be a figure anyone could send. */
  async finish(studentId: string, input: FinishTypingPracticeBody): Promise<TypingPractice> {
    const question = await this.prisma.question.findFirst({
      where: { id: input.questionId, type: QUESTION_TYPE.TYPING },
      select: PASSAGE_SELECT,
    });
    if (!question) throw new AppException(ErrorCodes.NOT_FOUND, 'No such passage');

    const { text } = toPassage(question);
    const result = scoreTyping(text, input.typed, TYPING_PRESETS[input.presetKey]);
    const row = await this.prisma.typingPractice.create({
      data: {
        studentId,
        questionId: input.questionId,
        presetKey: input.presetKey,
        keyDepressions: result.keyDepressions,
        wordsTyped: result.wordsTyped,
        fullMistakes: result.fullMistakes,
        halfMistakes: result.halfMistakes,
        errorPct: result.errorPct,
        grossWpm: result.grossWpm,
        netWpm: result.netWpm,
        qualified: result.qualified,
      },
    });
    return toPractice(row);
  }

  async history(
    studentId: string,
    query: TypingPracticeListQuery,
  ): Promise<Paginated<TypingPractice>> {
    const where: Prisma.TypingPracticeWhereInput = {
      studentId,
      ...(query.presetKey ? { presetKey: query.presetKey } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.typingPractice.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
      }),
      this.prisma.typingPractice.count({ where }),
    ]);
    return paged(query, rows.map(toPractice), total);
  }
}

function toPassage(row: PassageRow): TypingPracticePassage {
  const content = (row.currentVersion?.content ?? {}) as LocalizedContent;
  return {
    questionId: row.id,
    text: typingPassageText(plainTextOf(content[DEFAULT_LANGUAGE]?.stem)),
  };
}

function toPractice(row: PracticeRow): TypingPractice {
  return {
    id: row.id,
    presetKey: row.presetKey as TypingPresetKey,
    keyDepressions: row.keyDepressions,
    wordsTyped: row.wordsTyped,
    fullMistakes: row.fullMistakes,
    halfMistakes: row.halfMistakes,
    errorPct: Number(row.errorPct),
    grossWpm: Number(row.grossWpm),
    netWpm: Number(row.netWpm),
    qualified: row.qualified,
    createdAt: row.createdAt.toISOString(),
  };
}
