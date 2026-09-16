/**
 * Re-sanitises every QuestionVersion's content and options in place, closing crafted legacy markup
 * that predates the write guard. Idempotent, a transaction per batch, and it recomputes stemHash for
 * a question whose CURRENT version changed. Run per environment after deploy, outside a live window.
 */
import { Logger } from '@nestjs/common';
import { PrismaClient, type Prisma } from '@prisma/client';
import {
  DEFAULT_LANGUAGE,
  DIFFICULTY_LEVEL,
  plainTextOf,
  type LocalizedContent,
  type QuestionDetail,
  type QuestionDraft,
  type QuestionOption,
} from '@iace/contracts';
import { rewriteQuestionHtml } from './questions/question-content';
import { computeStemHash, sanitizeContentNode } from './questions/question-core';

const BATCH = 200;
const logger = new Logger('backfill-sanitize-question-content');

interface VersionRow {
  id: string;
  content: Prisma.JsonValue;
  options: Prisma.JsonValue | null;
}

interface CurrentVersion {
  content: Prisma.JsonValue;
  options: Prisma.JsonValue | null;
  answerKey: Prisma.JsonValue | null;
}

interface QuestionRow {
  id: string;
  type: QuestionDraft['type'];
  stemHash: string | null;
  currentVersionId: string | null;
  currentVersion: CurrentVersion | null;
}

const optionsOf = (options: Prisma.JsonValue | null): QuestionOption[] =>
  Array.isArray(options) ? (options as unknown as QuestionOption[]) : [];

const canonical = (value: unknown): string => JSON.stringify(value);

/** The version rebuilt through the shared transform — only the columns that differ, or null if none do. */
function sanitizedUpdate(row: VersionRow): Prisma.QuestionVersionUpdateInput | null {
  const detail = {
    content: (row.content as LocalizedContent | null) ?? {},
    options: optionsOf(row.options),
  } as unknown as QuestionDetail;
  const next = rewriteQuestionHtml(detail, sanitizeContentNode);
  const content = JSON.parse(canonical(next.content)) as Prisma.InputJsonValue;
  const options = JSON.parse(canonical(next.options)) as Prisma.InputJsonValue;

  const data: Prisma.QuestionVersionUpdateInput = {};
  if (canonical(content) !== canonical(row.content)) data.content = content;
  if (Array.isArray(row.options) && canonical(options) !== canonical(row.options)) {
    data.options = options;
  }
  return Object.keys(data).length > 0 ? data : null;
}

/** Only what the hash reads, mirroring backfill-stem-hashes.ts: the English of the current version. */
function draftOf(question: QuestionRow, version: CurrentVersion): QuestionDraft {
  const content = (version.content as LocalizedContent | null) ?? {};

  return {
    type: question.type,
    subjectId: '',
    difficulty: DIFFICULTY_LEVEL.MEDIUM,
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

async function* versionPages(prisma: PrismaClient): AsyncGenerator<VersionRow[]> {
  let cursor: string | undefined;

  for (;;) {
    const page = await prisma.questionVersion.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: { id: true, content: true, options: true },
    });
    const last = page.at(-1);
    if (last === undefined) return;

    yield page;
    cursor = last.id;
  }
}

async function* questionPages(prisma: PrismaClient): AsyncGenerator<QuestionRow[]> {
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
        currentVersionId: true,
        currentVersion: { select: { content: true, options: true, answerKey: true } },
      },
    });
    const last = page.at(-1);
    if (last === undefined) return;

    yield page;
    cursor = last.id;
  }
}

/** Every version through the shared transform, a transaction per batch; returns the ids that changed. */
export async function sanitizeVersions(
  prisma: PrismaClient,
): Promise<{ scanned: number; changed: Set<string> }> {
  const changed = new Set<string>();
  let scanned = 0;

  for await (const page of versionPages(prisma)) {
    scanned += page.length;
    const updates = page.flatMap((row) => {
      const data = sanitizedUpdate(row);
      return data ? [{ id: row.id, data }] : [];
    });
    if (updates.length === 0) continue;

    await prisma.$transaction(
      updates.map((update) =>
        prisma.questionVersion.update({ where: { id: update.id }, data: update.data }),
      ),
    );
    for (const update of updates) changed.add(update.id);
  }

  return { scanned, changed };
}

/** Recomputes stemHash for every question whose CURRENT version was rewritten, and no other. */
export async function recomputeHashes(prisma: PrismaClient, changed: Set<string>): Promise<number> {
  let rewritten = 0;

  for await (const page of questionPages(prisma)) {
    for (const question of page) {
      if (!question.currentVersion || !question.currentVersionId) continue;
      if (!changed.has(question.currentVersionId)) continue;

      const stemHash = computeStemHash(draftOf(question, question.currentVersion));
      if (stemHash === question.stemHash) continue;

      await prisma.question.update({ where: { id: question.id }, data: { stemHash } });
      rewritten += 1;
    }
  }

  return rewritten;
}

async function run(): Promise<void> {
  const prisma = new PrismaClient();

  try {
    const { scanned, changed } = await sanitizeVersions(prisma);
    const hashes = changed.size > 0 ? await recomputeHashes(prisma, changed) : 0;
    logger.log(
      `Scanned ${scanned} versions, rewrote ${changed.size}, recomputed ${hashes} stem hashes.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) void run();
