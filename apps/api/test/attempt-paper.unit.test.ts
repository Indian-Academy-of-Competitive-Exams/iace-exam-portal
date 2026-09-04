import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AppException,
  ErrorCodes,
  LANGUAGE_CODE,
  LANGUAGE_MODE,
  TIMER_TEMPLATE,
  type LanguageCode,
} from '@iace/contracts';
import { AttemptPaperService } from '../src/attempts/attempt-paper.service';
import {
  type FakeAttemptQuestionRow,
  type FakeServedVersion,
  FakeTestsPrisma,
  makeAttempt,
  makeBaseConfig,
  makeQuestion,
  makeSection,
  makeTest,
} from './support/fakes';

const STUDENT = 'stu_1';

const SECTIONS = [
  makeSection({ id: 'sec_1', name: 'Reasoning', order: 1, questionCount: 2, durationSec: 1200 }),
];

/** Options as the column holds them — `isCorrect` and all. Stripping it is the point. */
function version(id: string, correctId: string): FakeServedVersion {
  return {
    id,
    content: {
      en: { stem: [{ text: 'What comes next?' }], solution: [{ text: 'Because.' }] },
      hi: { stem: [{ text: 'आगे क्या आता है?' }] },
      te: { stem: [{ text: 'తరువాత ఏమిటి?' }] },
    },
    options: ['a', 'b', 'c', 'd'].map((letter, index) => ({
      id: `${id}_${letter}`,
      position: index + 1,
      isCorrect: `${id}_${letter}` === correctId,
      text: { en: [{ text: letter.toUpperCase() }], hi: [{ text: letter }] },
    })),
  };
}

function served(order: number, questionId: string): FakeAttemptQuestionRow {
  return {
    attemptId: 'att_1',
    questionId,
    paperQuestionId: `pq_${order}`,
    questionVersionId: `${questionId}_v1`,
    baseConfigSectionId: 'sec_1',
    order,
    selectedOptionId: null,
    typedAnswer: null,
    state: 'NOT_VISITED',
    timeSpentSec: 0,
  };
}

function serviceWith(
  languages: LanguageCode[] = [LANGUAGE_CODE.EN],
  config = makeBaseConfig({ id: 'cfg_1', languageMode: LANGUAGE_MODE.SINGLE }),
) {
  const paper = [1, 2].map((n) => ({
    id: `pq_${n}`,
    testId: 'tst_1',
    baseConfigId: 'cfg_1',
    baseConfigSectionId: 'sec_1',
    questionId: `q${n}`,
    questionVersionId: `q${n}_v1`,
    variant: 0,
    order: n,
    marks: 2,
    negativeMarks: 0.5,
    status: 'ACTIVE' as const,
  }));

  const prisma = new FakeTestsPrisma(
    [makeTest({ id: 'tst_1', baseConfigId: 'cfg_1' })],
    [config],
    SECTIONS,
    [],
    [makeQuestion({ id: 'q1' }), makeQuestion({ id: 'q2' })],
    paper,
    [],
    [makeAttempt({ id: 'att_1', studentId: STUDENT, languages })],
    [served(1, 'q1'), served(2, 'q2')],
    [version('q1_v1', 'q1_v1_b'), version('q2_v1', 'q2_v1_a')],
  );
  return { prisma, service: new AttemptPaperService(prisma.asService(), reachAll(), noStorage()) };
}

/** The paper is served on the ATTEMPT's own ownership; reach is the brief's gate, not this one. */
const reachAll = () => ({ assertReachable: () => Promise.resolve() }) as never;

/** No image is signed in these fixtures; a call would mean the paper started carrying one. */
const noStorage = () =>
  ({ createDownloadUrl: () => Promise.reject(new Error('unexpected sign')) }) as never;

describe('AttemptPaperService — what a candidate is allowed to see', () => {
  it('never tells the student which option is correct', async () => {
    const { service } = serviceWith();

    const paper = await service.paper(STUDENT, 'att_1');

    // The failure this prevents: `isCorrect` riding along in the options JSON to the browser.
    const serialized = JSON.stringify(paper);
    assert.ok(!serialized.includes('isCorrect'));
    for (const question of paper.questions) {
      for (const option of question.options) {
        assert.deepEqual(Object.keys(option).sort(), ['id', 'position', 'text']);
      }
    }
  });

  it('leaves the SOLUTION behind, which explains the answer just as plainly', async () => {
    const { service } = serviceWith();

    const paper = await service.paper(STUDENT, 'att_1');

    // The stem and the solution sit in one content object; only the stem is the student's to read.
    assert.deepEqual(Object.keys(paper.questions[0]?.content.en ?? {}), ['stem']);
    assert.ok(!JSON.stringify(paper).includes('Because.'));
  });

  it('carries no score or marks awarded either', async () => {
    const { service } = serviceWith();

    const serialized = JSON.stringify(await service.paper(STUDENT, 'att_1'));

    for (const leak of ['answerKey', 'marksAwarded', 'solution', 'correctCount']) {
      assert.ok(!serialized.includes(leak), `${leak} must not reach a candidate`);
    }
  });

  it('keeps the option id, so a shuffled paper still scores', async () => {
    const { service } = serviceWith(
      [LANGUAGE_CODE.EN],
      makeBaseConfig({ id: 'cfg_1', shuffleOptions: true }),
    );

    const paper = await service.paper(STUDENT, 'att_1');

    // Scoring compares ids, never positions — which is what makes shuffling safe at all.
    const ids = paper.questions[0]?.options.map((option) => option.id).sort();
    assert.deepEqual(ids, ['q1_v1_a', 'q1_v1_b', 'q1_v1_c', 'q1_v1_d']);
  });
});

describe('AttemptPaperService — the shape the screen draws from', () => {
  it('serves the questions in this student’s stored order', async () => {
    const { service } = serviceWith();

    const paper = await service.paper(STUDENT, 'att_1');

    assert.deepEqual(
      paper.questions.map((question) => [question.order, question.questionId]),
      [
        [1, 'q1'],
        [2, 'q2'],
      ],
    );
  });

  it('counts down to the server’s deadline and names the timing pattern', async () => {
    const { service } = serviceWith(
      [LANGUAGE_CODE.EN],
      makeBaseConfig({ id: 'cfg_1', timerTemplate: TIMER_TEMPLATE.SECTIONAL_LOCKED }),
    );

    const paper = await service.paper(STUDENT, 'att_1');

    assert.equal(paper.endsAt, '2026-08-24T05:00:00.000Z');
    assert.equal(paper.timerTemplate, TIMER_TEMPLATE.SECTIONAL_LOCKED);
    assert.deepEqual(
      paper.sections.map((section) => [section.name, section.questionCount, section.durationSec]),
      [['Reasoning', 2, 1200]],
    );
  });

  it('copies the marks the section set, per question', async () => {
    const { service } = serviceWith();

    const paper = await service.paper(STUDENT, 'att_1');

    assert.deepEqual(
      paper.questions.map((question) => [question.marks, question.negativeMarks]),
      [
        [2, 0.5],
        [2, 0.5],
      ],
    );
  });
});

describe('AttemptPaperService — the clock the countdown reads', () => {
  it('sends the server’s own now beside the deadline', async () => {
    const { service } = serviceWith();

    const before = Date.now();
    const paper = await service.paper(STUDENT, 'att_1');

    // The failure this prevents: a device clock ten minutes out sitting ten minutes more.
    const stamped = Date.parse(paper.serverNow);
    assert.ok(stamped >= before);
    assert.ok(stamped <= Date.now());
  });
});

describe('AttemptPaperService — language', () => {
  it('narrows to the one language a SINGLE sitting chose', async () => {
    const { service } = serviceWith([LANGUAGE_CODE.HI]);

    const paper = await service.paper(STUDENT, 'att_1');

    // A student sitting in Hindi is not handed the English paper alongside it.
    assert.deepEqual(Object.keys(paper.questions[0]?.content ?? {}), ['hi']);
    assert.deepEqual(Object.keys(paper.questions[0]?.options[0]?.text ?? {}), ['hi']);
  });

  it('carries both when the sitting is bilingual', async () => {
    const { service } = serviceWith(
      [LANGUAGE_CODE.EN, LANGUAGE_CODE.HI],
      makeBaseConfig({ id: 'cfg_1', languageMode: LANGUAGE_MODE.DUAL }),
    );

    const paper = await service.paper(STUDENT, 'att_1');

    assert.deepEqual(Object.keys(paper.questions[0]?.content ?? {}).sort(), ['en', 'hi']);
    assert.equal(paper.languageMode, LANGUAGE_MODE.DUAL);
  });

  it('leaves out a language the question was never authored in', async () => {
    const { service } = serviceWith([LANGUAGE_CODE.EN, LANGUAGE_CODE.TE]);

    const paper = await service.paper(STUDENT, 'att_1');

    // The stem has Telugu; the options do not, and an empty key would render as a blank option.
    assert.deepEqual(Object.keys(paper.questions[0]?.content ?? {}).sort(), ['en', 'te']);
    assert.deepEqual(Object.keys(paper.questions[0]?.options[0]?.text ?? {}), ['en']);
  });
});

describe('AttemptPaperService — whose sitting it is', () => {
  it('reads another student’s attempt as missing, not as refused', async () => {
    const { service } = serviceWith();

    // FORBIDDEN would confirm the id exists, which is a thing worth not confirming.
    const error = await service.paper('stu_other', 'att_1').catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });

  it('refuses a sitting that does not exist', async () => {
    const { service } = serviceWith();

    const error = await service.paper(STUDENT, 'att_gone').catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });
});

describe('AttemptPaperService — a paper read twice', () => {
  const optionIds = (paper: { questions: { options: { id: string }[] }[] }) =>
    paper.questions.map((question) => question.options.map((option) => option.id));

  it('serves the same shuffled order every time, because a reload is not a new paper', async () => {
    const { service } = serviceWith();

    const first = await service.paper(STUDENT, 'att_1');
    const again = await service.paper(STUDENT, 'att_1');

    // The failure this prevents: a student reloads mid-paper and the options move under them.
    assert.deepEqual(optionIds(again), optionIds(first));
  });

  it('shuffles the options it was given rather than losing or inventing one', async () => {
    const { service } = serviceWith();

    const paper = await service.paper(STUDENT, 'att_1');

    assert.deepEqual(
      optionIds(paper).map((ids) => [...ids].sort()),
      [
        ['q1_v1_a', 'q1_v1_b', 'q1_v1_c', 'q1_v1_d'],
        ['q2_v1_a', 'q2_v1_b', 'q2_v1_c', 'q2_v1_d'],
      ],
    );
  });
});
