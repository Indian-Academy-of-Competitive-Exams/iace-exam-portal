import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import { QUESTION_IMPORT_COLUMNS, type QuestionImportColumnKey } from '@iace/contracts';
import { AuditService } from '../src/audit/audit.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { STEM_HASH_VERSION } from '../src/questions/question-core';
import { QuestionImportService } from '../src/questions/question-import.service';
import { StemRehashService } from '../src/questions/stem-rehash.service';
import { FakeStorage } from '../test/support/fakes';
import { makeQuestionBank, resetDatabase, testPrisma } from './support/database';

const ADMIN = randomUUID();
const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

/** No commas anywhere: the sheet is written out as CSV. */
const ROW: Partial<Record<QuestionImportColumnKey, string>> = {
  subject: 'Quantitative Aptitude',
  difficulty: 'medium',
  option1_en: '5',
  option2_en: '50',
  option3_en: '0.5',
  option4_en: '500',
  correct_option: '1',
};

function sheet(...stems: string[]): Buffer {
  const header = QUESTION_IMPORT_COLUMNS.map((column) => column.header).join(',');
  const lines = stems.map((stem) =>
    QUESTION_IMPORT_COLUMNS.map(
      (column) => ({ ...ROW, stem_en: stem })[column.key as QuestionImportColumnKey] ?? '',
    ).join(','),
  );
  return Buffer.from([header, ...lines].join('\n'));
}

async function imported(...stems: string[]) {
  const service = new QuestionImportService(
    prisma,
    new FakeStorage() as never,
    new AuditService(prisma, new FakeStorage() as never),
  );
  const plan = await service.preview(sheet(...stems), ADMIN);
  return service.commit(plan.importLogId, { actorId: ADMIN });
}

/** What a row written under the old fold looks like: a hash it no longer matches, at version 1. */
const staled = () =>
  prisma.$executeRaw`UPDATE "Question" SET "stemHash" = 'old-fold', "stemHashVersion" = 1`;

const questions = () =>
  prisma.question.findMany({
    orderBy: { id: 'asc' },
    select: { id: true, stemHash: true, stemHashVersion: true, updatedAt: true },
  });

describe('StemRehashService.rehash', () => {
  it('brings a stale row back to the hash its own re-import computes, leaving updatedAt alone', async () => {
    await makeQuestionBank(prisma, { [ADMIN]: 'Admin One' });
    await imported('What is 10% of 50?');
    const [fresh] = await questions();
    await staled();

    assert.equal(await new StemRehashService(prisma).rehash(), 1);

    const [rehashed] = await questions();
    assert.equal(rehashed?.stemHash, fresh?.stemHash);
    assert.equal(rehashed?.stemHashVersion, STEM_HASH_VERSION);
    assert.equal(rehashed?.updatedAt.toISOString(), fresh?.updatedAt.toISOString());
    assert.equal((await imported('What is 10% of 50?')).created, 0, 'the re-import is a duplicate');
  });

  /** The failure this prevents: the pass writing a hash read before an edit over the edit's own. */
  it('leaves a question edited after the pass read it', async () => {
    await makeQuestionBank(prisma, { [ADMIN]: 'Admin One' });
    await imported('What is 10% of 50?');
    await staled();
    const editedMidPass = new Proxy(prisma, {
      get(target, property, receiver) {
        if (property !== 'question') return Reflect.get(target, property, receiver);
        return new Proxy(target.question, {
          get(question, method, inner) {
            if (method !== 'findMany') return Reflect.get(question, method, inner);
            return async (args: Parameters<typeof question.findMany>[0]) => {
              const read = await question.findMany(args);
              await target.$executeRaw`UPDATE "Question" SET "updatedAt" = now() + interval '1 second'`;
              return read;
            };
          },
        });
      },
    }) as PrismaService;

    assert.equal(await new StemRehashService(editedMidPass).rehash(), 0);
    const [untouched] = await questions();
    assert.equal(untouched?.stemHash, 'old-fold');
  });

  it('has nothing to do once every row is current', async () => {
    await makeQuestionBank(prisma, { [ADMIN]: 'Admin One' });
    await imported('What is 10% of 50?');

    assert.equal(await new StemRehashService(prisma).rehash(), 0);
  });
});

describe('a stem differing only by a decimal point', () => {
  /** The failure this prevents: "x = 25" skipped on import as a duplicate of "x = 2.5". */
  it('imports as a question of its own', async () => {
    await makeQuestionBank(prisma, { [ADMIN]: 'Admin One' });

    const result = await imported('If x = 2.5 what is 20x?', 'If x = 25 what is 20x?');

    assert.equal(result.created, 2);
  });
});
