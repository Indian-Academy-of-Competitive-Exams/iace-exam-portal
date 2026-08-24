/**
 * Recomputes `Question.stemHash` from the current version. The canonical key behind it folds
 * markup away now, so a hash written before that fold is a value nothing computes again — the
 * duplicate check and the importer both look it up and miss, and the question is written twice.
 * Run after any change to `canonicalStemKey`, and after the dev seed, which leaves it null.
 */
import { Logger } from '@nestjs/common';
import { PrismaClient, type Prisma } from '@prisma/client';
import {
  DEFAULT_LANGUAGE,
  plainTextOf,
  type LocalizedContent,
  type QuestionDraft,
  type QuestionOption,
} from '@iace/contracts';
import { computeStemHash } from './questions/question-core';

const BATCH = 500;
const logger = new Logger('backfill-stem-hashes');

interface VersionRow {
  content: Prisma.JsonValue;
  options: Prisma.JsonValue;
  answerKey: Prisma.JsonValue;
}

interface QuestionRow {
  id: string;
  type: QuestionDraft['type'];
  stemHash: string | null;
  currentVersion: VersionRow | null;
}

const optionsOf = (options: Prisma.JsonValue): QuestionOption[] =>
  Array.isArray(options) ? (options as unknown as QuestionOption[]) : [];

/** Only what the hash reads: the English of the question, however the row happens to hold it. */
function draftOf(question: QuestionRow, version: VersionRow): QuestionDraft {
  const content = (version.content as LocalizedContent | null) ?? {};

  return {
    type: question.type,
    subjectId: '',
    difficulty: 'MEDIUM',
    stem: { [DEFAULT_LANGUAGE]: plainTextOf(content[DEFAULT_LANGUAGE]?.stem) },
    options: optionsOf(version.options).map((option) => ({
      position: option.position,
      isCorrect: option.isCorrect,
      text: { [DEFAULT_LANGUAGE]: plainTextOf(option.text[DEFAULT_LANGUAGE]) },
    })),
    answerKey: (version.answerKey as QuestionDraft['answerKey']) ?? null,
    tags: [],
  };
}

async function* pagesOf(prisma: PrismaClient): AsyncGenerator<QuestionRow[]> {
  let cursor: string | undefined;

  for (;;) {
    const page = await prisma.question.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        type: true,
        stemHash: true,
        currentVersion: { select: { content: true, options: true, answerKey: true } },
      },
    });
    if (page.length === 0) return;

    yield page;
    cursor = page.at(-1)!.id;
  }
}

async function run(): Promise<void> {
  const prisma = new PrismaClient();
  let read = 0;
  let written = 0;

  try {
    for await (const page of pagesOf(prisma)) {
      read += page.length;

      for (const question of page) {
        if (!question.currentVersion) continue;

        const stemHash = computeStemHash(draftOf(question, question.currentVersion));
        if (stemHash === question.stemHash) continue;

        await prisma.question.update({ where: { id: question.id }, data: { stemHash } });
        written += 1;
      }
    }

    logger.log(`Read ${read} questions, rewrote ${written} stem hashes.`);
  } finally {
    await prisma.$disconnect();
  }
}

void run();
