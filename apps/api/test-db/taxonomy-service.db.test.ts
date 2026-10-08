import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { AppException, ErrorCodes } from '@iace/contracts';
import { AuditContext } from '../src/audit';
import { TaxonomyService } from '../src/questions/taxonomy.service';
import {
  BANK,
  makeBankQuestion,
  makeCatalog,
  makeQuestionBank,
  makeSection,
  makeSubject,
  makeTest,
  resetDatabase,
  testPrisma,
  uid,
} from './support/database';

const prisma = testPrisma();
const taxonomy = new TaxonomyService(prisma, new AuditContext());

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

/** The refusal a delete answers with, so a case can assert what it names. */
async function refusal(attempt: () => Promise<unknown>): Promise<AppException> {
  try {
    await attempt();
  } catch (error) {
    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
    return error;
  }
  return assert.fail('The delete was not refused');
}

describe('TaxonomyService.removeSubject', () => {
  it('deletes a subject nothing carries', async () => {
    await makeQuestionBank(prisma);
    const empty = await makeSubject(prisma);

    await taxonomy.removeSubject(empty.id);

    assert.equal(await prisma.subject.count({ where: { id: empty.id } }), 0);
    assert.equal(await prisma.subject.count(), 2);
  });

  it('refuses a subject that still has topics, questions or a section, and names each', async () => {
    await makeQuestionBank(prisma);
    await makeBankQuestion(prisma, { id: uid(), subjectId: BANK.QUANT, topicId: BANK.ARITHMETIC });
    const catalog = await makeCatalog(prisma);
    const section = await makeSection(prisma, catalog);
    await prisma.baseConfigSection.update({
      where: { id: section.id },
      data: { subjectId: BANK.QUANT },
    });

    const error = await refusal(() => taxonomy.removeSubject(BANK.QUANT));

    assert.match(error.message, /2 topics/);
    assert.match(error.message, /1 question\b/);
    assert.match(error.message, /1 base configuration section\b/);
    assert.equal(await prisma.subject.count({ where: { id: BANK.QUANT } }), 1);
  });

  it('says a subject that is not there is not there', async () => {
    await assert.rejects(
      () => taxonomy.removeSubject(uid()),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.NOT_FOUND,
    );
  });
});

describe('TaxonomyService.removeTopic', () => {
  it('deletes a topic nothing carries, and leaves its siblings', async () => {
    await makeQuestionBank(prisma);

    await taxonomy.removeTopic(BANK.HISTORY);

    assert.equal(await prisma.topic.count({ where: { id: BANK.HISTORY } }), 0);
    assert.equal(await prisma.topic.count({ where: { subjectId: BANK.QUANT } }), 2);
  });

  it('refuses a topic that still has questions filed under it', async () => {
    await makeQuestionBank(prisma);
    await makeBankQuestion(prisma, { id: uid(), subjectId: BANK.QUANT, topicId: BANK.ALGEBRA });

    const error = await refusal(() => taxonomy.removeTopic(BANK.ALGEBRA));

    assert.match(error.message, /1 question\b/);
    assert.equal(await prisma.topic.count({ where: { id: BANK.ALGEBRA } }), 1);
  });

  it('refuses a topic a test names in its draw settings, and only that topic', async () => {
    await makeQuestionBank(prisma);
    const catalog = await makeCatalog(prisma);
    const section = await makeSection(prisma, catalog);
    const test = await makeTest(prisma, catalog);
    await prisma.test.update({
      where: { id: test.id },
      data: { questionPoolFilter: { sections: { [section.id]: { topicIds: [BANK.ARITHMETIC] } } } },
    });

    const error = await refusal(() => taxonomy.removeTopic(BANK.ARITHMETIC));
    assert.match(error.message, /1 test that draws from it/);

    await taxonomy.removeTopic(BANK.ALGEBRA);
    assert.equal(await prisma.topic.count({ where: { id: BANK.ALGEBRA } }), 0);
  });
});

describe('TaxonomyService.updateSubject', () => {
  it('refuses a rename onto a name another subject holds, on the name field', async () => {
    await makeQuestionBank(prisma);

    const error = await refusal(() =>
      taxonomy.updateSubject(BANK.GENERAL_AWARENESS, { name: 'QUANTITATIVE APTITUDE' }),
    );

    assert.deepEqual(error.fieldErrors?.name, ['QUANTITATIVE APTITUDE already exists']);
  });

  it('lets a subject be saved under its own name again', async () => {
    await makeQuestionBank(prisma);

    const saved = await taxonomy.updateSubject(BANK.QUANT, { name: 'QUANTITATIVE APTITUDE' });

    assert.equal(saved.name, 'QUANTITATIVE APTITUDE');
  });
});
