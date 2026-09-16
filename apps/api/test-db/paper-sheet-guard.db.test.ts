import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { ATTEMPT_STATUS, PAPER_QUESTION_STATUS } from '@iace/contracts';
import {
  fourOptions,
  makePaper,
  makeQuestion,
  makeStudent,
  resetDatabase,
  sitPaper,
  testPrisma,
} from './support/database';

const prisma = testPrisma();
beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const SAT_PAPER = /A paper somebody has sat cannot change/;

const optionIdsOf = async (versionId: string) => {
  const version = await prisma.questionVersion.findUniqueOrThrow({ where: { id: versionId } });
  return (version.options as { id: string }[]).map((option) => option.id);
};

describe('PaperQuestion triggers', () => {
  it('copies the pinned version’s option ids onto the paper row, in stored order', async () => {
    const paper = await makePaper(prisma, { questions: ['Reasoning'] });
    const [item] = paper.items;

    const row = await prisma.paperQuestion.findUniqueOrThrow({
      where: { id: item?.paperQuestionId ?? '' },
    });

    assert.deepEqual(row.optionIds, await optionIdsOf(item?.versionId ?? ''));
    assert.equal(row.optionIds.length, 4);
  });

  it('lets a paper nobody has sat change, and follows a repointed question’s options', async () => {
    const paper = await makePaper(prisma, { questions: ['Reasoning', 'Reasoning'] });
    const [first, second] = paper.items;
    const other = await makeQuestion(prisma, {
      subjectId: first?.subjectId ?? '',
      options: fourOptions(),
    });

    await prisma.paperQuestion.update({
      where: { id: first?.paperQuestionId ?? '' },
      data: { questionId: other.id, questionVersionId: other.versionId },
    });
    await prisma.paperQuestion.delete({ where: { id: second?.paperQuestionId ?? '' } });

    const row = await prisma.paperQuestion.findUniqueOrThrow({
      where: { id: first?.paperQuestionId ?? '' },
    });
    assert.deepEqual(row.optionIds, await optionIdsOf(other.versionId));
  });

  it('refuses to add, remove or reprice a row once somebody has sat the paper', async () => {
    const paper = await makePaper(prisma, { questions: ['Reasoning', 'Reasoning'] });
    const [first] = paper.items;
    await sitPaper(prisma, {
      paper,
      studentId: (await makeStudent(prisma)).id,
      chosen: [null, null],
      status: ATTEMPT_STATUS.IN_PROGRESS,
      submittedAt: null,
    });
    const extra = await makeQuestion(prisma, { subjectId: first?.subjectId ?? '' });

    await assert.rejects(
      prisma.paperQuestion.delete({ where: { id: first?.paperQuestionId ?? '' } }),
      SAT_PAPER,
    );
    await assert.rejects(
      prisma.paperQuestion.update({
        where: { id: first?.paperQuestionId ?? '' },
        data: { marks: 3 },
      }),
      SAT_PAPER,
    );
    await assert.rejects(
      prisma.paperQuestion.create({
        data: {
          testId: paper.testId,
          baseConfigId: paper.catalog.baseConfigId,
          baseConfigSectionId: paper.sectionIds[0] ?? '',
          questionId: extra.id,
          questionVersionId: extra.versionId,
          order: 3,
          marks: 2,
          negativeMarks: 0.5,
        },
      }),
      SAT_PAPER,
    );
  });

  it('still moves a sat question’s status, which is how a drop or a bonus lands', async () => {
    const paper = await makePaper(prisma, { questions: ['Reasoning'] });
    const [first] = paper.items;
    await sitPaper(prisma, { paper, studentId: (await makeStudent(prisma)).id, chosen: [null] });

    await prisma.paperQuestion.update({
      where: { id: first?.paperQuestionId ?? '' },
      data: { status: PAPER_QUESTION_STATUS.DROPPED },
    });

    const row = await prisma.paperQuestion.findUniqueOrThrow({
      where: { id: first?.paperQuestionId ?? '' },
    });
    assert.equal(row.status, PAPER_QUESTION_STATUS.DROPPED);
  });
});
