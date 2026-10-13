import { randomInt } from 'node:crypto';
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
// ponytail: every free passage is read to pick one; store its length on Question past a few hundred.
const PASSAGE_POOL_MAX = 300;

type PassageRow = Prisma.QuestionGetPayload<{ select: typeof PASSAGE_SELECT }>;

/** Owns `TypingPractice` (docs/03 §5) — the only module that writes it. */
@Injectable()
export class TypingService {
  constructor(private readonly prisma: PrismaService) {}

  /** A bank passage no test holds: one written for a paper must not be met in practice first. */
  async passageFor(presetKey: TypingPresetKey): Promise<TypingPracticePassage> {
    const rows = await this.prisma.question.findMany({
      where: {
        type: QUESTION_TYPE.TYPING,
        status: QUESTION_STATUS.ACTIVE,
        paperQuestions: { none: {} },
      },
      select: PASSAGE_SELECT,
      orderBy: { id: 'desc' },
      take: PASSAGE_POOL_MAX,
    });

    const need = typingPassageNeed(TYPING_PRESETS[presetKey]);
    const longEnough = rows.map(toPassage).filter((passage) => passage.text.length >= need);
    const picked = longEnough[randomInt(Math.max(1, longEnough.length))];
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
