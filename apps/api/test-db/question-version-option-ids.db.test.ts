import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { makePaper, makeTest, resetDatabase, testPrisma, uid } from './support/database';

const prisma = testPrisma();

/** Four options with ids the fixture did not use, so a stale array is visible rather than lucky. */
const renamedOptions = () =>
  Array.from({ length: 4 }, (_, index) => ({
    id: `renamed${index + 1}`,
    position: index + 1,
    isCorrect: index === 0,
    text: { en: [{ type: 'TEXT', text: `Option ${index + 1}` }] },
  }));

describe('question version option ids', () => {
  beforeEach(() => resetDatabase(prisma));
  after(() => prisma.$disconnect());

  it('resyncs every paper pinning a version, not only one', async () => {
    const paper = await makePaper(prisma, { questions: ['Maths'] });
    const [item] = paper.items;
    assert.ok(item);

    const second = await makeTest(prisma, paper.catalog);
    const secondRow = await prisma.paperQuestion.create({
      data: {
        id: uid(),
        testId: second.id,
        baseConfigId: paper.catalog.baseConfigId,
        baseConfigSectionId: item.sectionId,
        questionId: item.questionId,
        questionVersionId: item.versionId,
        order: 1,
        marks: 2,
        negativeMarks: 0.5,
      },
      select: { id: true },
    });

    await prisma.questionVersion.update({
      where: { id: item.versionId },
      data: { options: renamedOptions() },
    });

    const rows = await prisma.paperQuestion.findMany({
      where: { id: { in: [item.paperQuestionId, secondRow.id] } },
      select: { id: true, optionIds: true },
      orderBy: { id: 'asc' },
    });

    const expected = ['renamed1', 'renamed2', 'renamed3', 'renamed4'];
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.deepEqual(row.optionIds, expected, `paper row ${row.id} kept a stale option list`);
    }
  });

  it('follows a reorder so a stored position still names the option it showed', async () => {
    const paper = await makePaper(prisma, { questions: ['Maths'] });
    const [item] = paper.items;
    assert.ok(item);

    const reversed = renamedOptions()
      .reverse()
      .map((option, index) => ({
        ...option,
        position: index + 1,
      }));
    await prisma.questionVersion.update({
      where: { id: item.versionId },
      data: { options: reversed },
    });

    const row = await prisma.paperQuestion.findUniqueOrThrow({
      where: { id: item.paperQuestionId },
      select: { optionIds: true },
    });
    assert.deepEqual(row.optionIds, ['renamed4', 'renamed3', 'renamed2', 'renamed1']);
  });
});
