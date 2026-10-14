import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { type QuestionOption } from '@iace/contracts';
import { contentHashOf, fingerprint } from './question-audit';
import { type BuiltQuestion } from './question-core';
import { reachableTest } from './question-query';
import { type QuestionRow } from './question-rows';

/** An attempt stores the option id it was shown, so a position that had one keeps it. */
export function optionsWithIds(built: BuiltQuestion, previous: QuestionOption[]) {
  return built.options.map((option) => ({
    id: previous.find((old) => old.position === option.position)?.id ?? randomUUID(),
    position: option.position,
    isCorrect: option.isCorrect,
    text: option.text,
  }));
}

/** A version row from a built draft and the options its ids have already been merged into. */
export function versionDataOf(
  questionId: string,
  version: number,
  built: BuiltQuestion,
  options: QuestionOption[],
  createdById: string,
): Prisma.QuestionVersionUncheckedCreateInput {
  return {
    questionId,
    version,
    createdById,
    content: built.content as Prisma.InputJsonValue,
    options: options as unknown as Prisma.InputJsonValue,
    answerKey: (built.answerKey ?? Prisma.JsonNull) as Prisma.InputJsonValue,
  };
}

/** A save that says the same thing writes no version, and puts no new hand on the row. */
export async function versionFor(
  tx: Prisma.TransactionClient,
  question: QuestionRow,
  built: BuiltQuestion,
  options: QuestionOption[],
  createdById: string,
): Promise<{ id: string; reworded: boolean }> {
  const says = fingerprint(built.content, options, built.answerKey ?? null);
  if (question.currentVersionId && says === contentHashOf(question)) {
    return { id: question.currentVersionId, reworded: false };
  }

  const revisable = await revisableVersionId(tx, question);
  const id = revisable
    ? await revise(tx, revisable, built, options, createdById)
    : await insertVersion(tx, question, built, options, createdById);
  return { id, reworded: true };
}

/** Rewritable until a test students can already reach pins it — the paper must never move under them. */
async function revisableVersionId(
  tx: Prisma.TransactionClient,
  question: QuestionRow,
): Promise<string | null> {
  const questionVersionId = question.currentVersionId;
  if (!questionVersionId) return null;

  const reached = await tx.paperQuestion.count({
    where: { questionId: question.id, questionVersionId, test: reachableTest(new Date()) },
  });
  return reached > 0 ? null : questionVersionId;
}

/** A version no reachable test pins yet stays this version, however often it is saved. */
async function revise(
  tx: Prisma.TransactionClient,
  versionId: string,
  built: BuiltQuestion,
  options: QuestionOption[],
  createdById: string,
): Promise<string> {
  await tx.questionVersion.update({
    where: { id: versionId },
    data: {
      content: built.content as Prisma.InputJsonValue,
      options: options as unknown as Prisma.InputJsonValue,
      answerKey: (built.answerKey ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      // The words and the moment are now this admin's, not those of whoever opened the draft.
      createdById,
      createdAt: new Date(),
    },
  });
  return versionId;
}

/** Nothing that pinned the old version moves, which is the entire reason versions exist. */
async function insertVersion(
  tx: Prisma.TransactionClient,
  question: QuestionRow,
  built: BuiltQuestion,
  options: QuestionOption[],
  createdById: string,
): Promise<string> {
  const version = await tx.questionVersion.create({
    data: versionDataOf(
      question.id,
      (question.currentVersion?.version ?? 0) + 1,
      built,
      options,
      createdById,
    ),
  });
  return version.id;
}
