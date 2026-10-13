import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  AppException,
  ErrorCodes,
  QUESTION_STATUS,
  QUESTION_TYPE,
  TYPING_PRESET_KEY,
  type QuestionStatus,
} from '@iace/contracts';
import { drawableFor } from '../src/questions/question-core';
import { TypingService } from '../src/typing/typing.service';
import {
  makePaper,
  makeQuestion,
  makeStudent,
  makeSubject,
  resetDatabase,
  testPrisma,
} from './support/database';

const prisma = testPrisma();
const typing = new TypingService(prisma);
const PAGE = { page: 1, pageSize: 20 };

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const codeOf = (error: unknown) => (AppException.is(error) ? error.code : null);
const notFound = (error: unknown) => codeOf(error) === ErrorCodes.NOT_FOUND;

/** Distinct four-letter words: each with its space is five key depressions. */
const wordsOf = (count: number) =>
  Array.from({ length: count }, (_, index) => `w${String(index).padStart(3, '0')}`);

async function passageOf(words: number, status: QuestionStatus = QUESTION_STATUS.ACTIVE) {
  const subject = await makeSubject(prisma);
  return makeQuestion(prisma, {
    subjectId: subject.id,
    type: QUESTION_TYPE.TYPING,
    stem: wordsOf(words).join(' '),
    status,
  });
}

describe('TypingService.passageFor', () => {
  it('hands a standard only a passage long enough for it, as plain text', async () => {
    await passageOf(320);
    const long = await passageOf(800);

    const handed = await typing.passageFor(TYPING_PRESET_KEY.SSC_CHSL_DEO_15000);

    assert.equal(handed.questionId, long.id);
    assert.equal(handed.text, wordsOf(800).join(' '));
  });

  it('refuses a standard no passage is long enough for', async () => {
    await passageOf(320);

    await assert.rejects(typing.passageFor(TYPING_PRESET_KEY.SSC_CHSL_DEO_15000), notFound);
  });

  it('never hands out an archived passage or a question of another type', async () => {
    await passageOf(800, QUESTION_STATUS.ARCHIVED);
    const subject = await makeSubject(prisma);
    await makeQuestion(prisma, { subjectId: subject.id, stem: wordsOf(800).join(' ') });

    await assert.rejects(typing.passageFor(TYPING_PRESET_KEY.RRB_NTPC_TYPING_EN), notFound);
  });

  it('keeps a passage a test holds out of practice', async () => {
    const paper = await makePaper(prisma, { title: 'Typing mock', questions: ['Reasoning'] });
    const held = paper.items[0]?.questionId ?? '';
    await prisma.question.update({ where: { id: held }, data: { type: QUESTION_TYPE.TYPING } });
    await prisma.questionVersion.updateMany({
      where: { questionId: held },
      data: { content: { en: { stem: [{ type: 'TEXT', text: wordsOf(800).join(' ') }] } } },
    });

    await assert.rejects(typing.passageFor(TYPING_PRESET_KEY.RRB_NTPC_TYPING_EN), notFound);
  });
});

describe('TypingService.finish', () => {
  it('scores what was typed itself and keeps the figures against the student', async () => {
    const student = await makeStudent(prisma);
    const other = await makeStudent(prisma);
    const passage = await passageOf(400);

    const result = await typing.finish(student.id, {
      presetKey: TYPING_PRESET_KEY.SSC_CHSL_TYPING_EN,
      questionId: passage.id,
      typed: wordsOf(351).join(' '),
    });
    const mine = await typing.history(student.id, PAGE);
    const theirs = await typing.history(other.id, PAGE);

    assert.equal(result.qualified, true);
    assert.equal(result.wordsTyped, 351);
    assert.deepEqual(
      mine.items.map((row) => row.id),
      [result.id],
    );
    assert.equal(theirs.items.length, 0);
  });

  it('refuses a question that is not a typing passage', async () => {
    const student = await makeStudent(prisma);
    const subject = await makeSubject(prisma);
    const mcq = await makeQuestion(prisma, { subjectId: subject.id });

    await assert.rejects(
      typing.finish(student.id, {
        presetKey: TYPING_PRESET_KEY.SSC_CHSL_TYPING_EN,
        questionId: mcq.id,
        typed: 'Stem',
      }),
      notFound,
    );
  });

  it('narrows the history to one standard', async () => {
    const student = await makeStudent(prisma);
    const passage = await passageOf(400);
    const typed = wordsOf(10).join(' ');
    for (const presetKey of [
      TYPING_PRESET_KEY.SSC_CHSL_TYPING_EN,
      TYPING_PRESET_KEY.RRB_NTPC_TYPING_EN,
    ]) {
      await typing.finish(student.id, { presetKey, questionId: passage.id, typed });
    }

    const rrb = await typing.history(student.id, {
      ...PAGE,
      presetKey: TYPING_PRESET_KEY.RRB_NTPC_TYPING_EN,
    });

    assert.deepEqual(
      rrb.items.map((row) => row.presetKey),
      [TYPING_PRESET_KEY.RRB_NTPC_TYPING_EN],
    );
  });
});

describe('a typing passage in the bank', () => {
  it('is never offered to an ordinary section, which could only show it with nothing to answer', async () => {
    const passage = await passageOf(400);
    const subject = await makeSubject(prisma);
    const mcq = await makeQuestion(prisma, { subjectId: subject.id });

    const drawable = await prisma.question.findMany({ where: drawableFor(), select: { id: true } });
    const ids = drawable.map((row) => row.id);

    assert.ok(ids.includes(mcq.id));
    assert.ok(!ids.includes(passage.id));
  });

  it('can be deleted with the practice history typed against it', async () => {
    const student = await makeStudent(prisma);
    const passage = await passageOf(400);
    await typing.finish(student.id, {
      presetKey: TYPING_PRESET_KEY.SSC_CHSL_TYPING_EN,
      questionId: passage.id,
      typed: 'w000',
    });

    await prisma.question.update({ where: { id: passage.id }, data: { currentVersionId: null } });
    await prisma.questionVersion.deleteMany({ where: { questionId: passage.id } });
    await prisma.question.delete({ where: { id: passage.id } });

    assert.equal(await prisma.typingPractice.count(), 0);
  });
});
