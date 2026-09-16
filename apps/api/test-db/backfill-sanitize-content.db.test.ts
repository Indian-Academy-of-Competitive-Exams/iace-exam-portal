import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import type { Prisma } from '@prisma/client';
import { recomputeHashes, sanitizeVersions } from '../src/backfill-sanitize-question-content';
import {
  fourOptions,
  makePaper,
  makeQuestion,
  makeStudent,
  makeSubject,
  resetDatabase,
  sitPaper,
  testPrisma,
} from './support/database';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const TRACKER = 'https://tracker.example/x.gif';
const CRAFTED = `<p><image data-key="k" src="${TRACKER}"></p>`;
const LEGIT = '<div><p><img data-key="questions/images/a.png" alt="figure"></p></div>';

const contentOf = (stem: string): Prisma.InputJsonValue => ({
  en: { stem: [{ type: 'TEXT', text: stem }] },
});

const readVersion = (id: string) =>
  prisma.questionVersion.findUniqueOrThrow({ where: { id }, select: { content: true } });

async function backfill(): Promise<{ scanned: number; changed: Set<string>; hashes: number }> {
  const { scanned, changed } = await sanitizeVersions(prisma);
  const hashes = await recomputeHashes(prisma, changed);
  return { scanned, changed, hashes };
}

describe('backfill-sanitize-question-content', () => {
  it('neutralises a crafted stem in place, keeping the version id', async () => {
    const subject = (await makeSubject(prisma)).id;
    const created = await makeQuestion(prisma, {
      subjectId: subject,
      content: contentOf(CRAFTED),
      options: fourOptions(),
    });

    const { changed } = await backfill();

    assert.ok(changed.has(created.versionId));
    const after = JSON.stringify((await readVersion(created.versionId)).content);
    assert.doesNotMatch(after, /tracker\.example/);
    assert.ok(await prisma.questionVersion.findUnique({ where: { id: created.versionId } }));
  });

  it('leaves a legitimate row byte-for-byte unchanged', async () => {
    const subject = (await makeSubject(prisma)).id;
    const created = await makeQuestion(prisma, { subjectId: subject, content: contentOf(LEGIT) });
    const before = JSON.stringify((await readVersion(created.versionId)).content);

    const { changed } = await backfill();

    assert.equal(changed.has(created.versionId), false);
    assert.equal(JSON.stringify((await readVersion(created.versionId)).content), before);
  });

  it('keeps a version pinned by a paper and an attempt referencing the same id', async () => {
    const paper = await makePaper(prisma, {
      questions: [{ subject: 'Quant', content: contentOf(CRAFTED) }],
    });
    const [item] = paper.items;
    assert.ok(item);
    const student = (await makeStudent(prisma)).id;
    await sitPaper(prisma, { paper, studentId: student, chosen: ['o1'] });

    const { changed } = await backfill();

    assert.ok(changed.has(item.versionId));
    const pinned = await prisma.paperQuestion.findFirstOrThrow({
      where: { id: item.paperQuestionId },
    });
    assert.equal(pinned.questionVersionId, item.versionId);
    const sat = await prisma.attemptQuestion.findFirstOrThrow({
      where: { questionId: item.questionId },
    });
    assert.equal(sat.questionVersionId, item.versionId);
    assert.doesNotMatch(
      JSON.stringify((await readVersion(item.versionId)).content),
      /tracker\.example/,
    );
  });

  it('recomputes stemHash for a changed current version, and not for an unchanged one', async () => {
    const subject = (await makeSubject(prisma)).id;
    const changedStem = await makeQuestion(prisma, {
      subjectId: subject,
      content: contentOf('<p>Capital of Telangana?<script>track()</script></p>'),
    });
    const steady = await makeQuestion(prisma, { subjectId: subject, content: contentOf(LEGIT) });
    await prisma.question.update({ where: { id: changedStem.id }, data: { stemHash: 'stale' } });
    await prisma.question.update({ where: { id: steady.id }, data: { stemHash: 'kept' } });

    const { hashes } = await backfill();

    assert.equal(hashes, 1);
    const after = await prisma.question.findUniqueOrThrow({ where: { id: changedStem.id } });
    assert.notEqual(after.stemHash, 'stale');
    assert.match(after.stemHash ?? '', /^[0-9a-f]{64}$/);
    assert.equal(
      (await prisma.question.findUniqueOrThrow({ where: { id: steady.id } })).stemHash,
      'kept',
    );
  });

  it('changes nothing on a second run', async () => {
    const subject = (await makeSubject(prisma)).id;
    await makeQuestion(prisma, {
      subjectId: subject,
      content: contentOf(CRAFTED),
      options: fourOptions(),
    });
    await makePaper(prisma, { questions: [{ subject: 'Quant', content: contentOf(CRAFTED) }] });

    await backfill();
    const second = await backfill();

    assert.equal(second.changed.size, 0);
    assert.equal(second.hashes, 0);
  });
});
