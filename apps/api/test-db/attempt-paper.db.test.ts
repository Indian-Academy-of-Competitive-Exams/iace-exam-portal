import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  ATTEMPT_STATUS,
  AppException,
  ErrorCodes,
  LANGUAGE_CODE,
  LANGUAGE_MODE,
  TIMER_TEMPLATE,
  type LanguageCode,
  type LanguageMode,
  servedQuestions,
  type TimerTemplate,
} from '@iace/contracts';
import { AttemptPaperService } from '../src/attempts/attempt-paper.service';
import { PaperSheetService } from '../src/attempts/paper-sheet.service';
import { AttemptReportService } from '../src/attempts/attempt-report.service';
import { LeaderboardService } from '../src/attempts/leaderboard.service';
import {
  makePaper,
  makeStudent,
  resetDatabase,
  sitPaper,
  testPrisma,
  uid,
} from './support/database';

const LETTERS = ['a', 'b', 'c', 'd'];
const ENDS_AT = '2026-08-24T05:00:00.000Z';
const HOUR_MS = 60 * 60 * 1000;

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

/** The paper is served on the ATTEMPT's own ownership; reach is the brief's gate, not this one. */
const reachAll = () =>
  ({
    reachableTest: () => Promise.resolve(),
    assertCanStart: () => Promise.resolve(),
    // Bumped per case, so a held test row is never carried from one fixture into the next.
    catalogEpoch: () => Promise.resolve(Date.now()),
  }) as never;

/** No image is resolved in these fixtures; a call would mean the paper started carrying one. */
const noStorage = () =>
  ({
    publicUrl: () => {
      throw new Error('unexpected image');
    },
  }) as never;

const service = new AttemptPaperService(
  prisma,
  reachAll(),
  noStorage(),
  new PaperSheetService(prisma),
);
const reports = () => new AttemptReportService(prisma, new LeaderboardService(prisma), noStorage());

/** Content in three languages, and options as the column holds them — `isCorrect` and all. */
const question = {
  subject: 'Reasoning',
  content: {
    en: {
      stem: [{ type: 'TEXT', text: 'What comes next?' }],
      solution: [{ type: 'TEXT', text: 'Because.' }],
    },
    hi: { stem: [{ type: 'TEXT', text: 'आगे क्या आता है?' }] },
    te: { stem: [{ type: 'TEXT', text: 'తరువాత ఏమిటి?' }] },
  },
  options: LETTERS.map((letter, index) => ({
    id: letter,
    position: index + 1,
    isCorrect: index === 1,
    text: {
      en: [{ type: 'TEXT', text: letter.toUpperCase() }],
      hi: [{ type: 'TEXT', text: letter }],
    },
  })),
};

interface Sat {
  stem?: string;
  languages?: LanguageCode[];
  languageMode?: LanguageMode;
  shuffleOptions?: boolean;
  timerTemplate?: TimerTemplate;
}

/** One student's sitting of a two-question paper in a twenty-minute section, due at ENDS_AT. */
async function sitting(over: Sat = {}) {
  const asked = over.stem
    ? {
        ...question,
        content: { ...question.content, en: { stem: [{ type: 'TEXT', text: over.stem }] } },
      }
    : question;
  const paper = await makePaper(prisma, {
    sections: ['Reasoning'],
    questions: [asked, asked],
  });
  // The section's clock first: a SECTIONAL_LOCKED config refuses a section without one.
  await prisma.baseConfigSection.update({
    where: { id: paper.sectionIds[0] ?? '' },
    data: { questionCount: 2, durationSec: 1200 },
  });
  await prisma.baseConfig.update({
    where: { id: paper.catalog.baseConfigId },
    data: {
      languageMode: over.languageMode ?? LANGUAGE_MODE.SINGLE,
      shuffleOptions: over.shuffleOptions ?? true,
      ...(over.timerTemplate ? { timerTemplate: over.timerTemplate } : {}),
    },
  });
  const student = (await makeStudent(prisma)).id;
  const attempt = await sitPaper(prisma, {
    paper,
    studentId: student,
    chosen: [null, null],
    status: ATTEMPT_STATUS.IN_PROGRESS,
    startedAt: new Date(Date.parse(ENDS_AT) - HOUR_MS),
    submittedAt: null,
    languages: over.languages ?? [LANGUAGE_CODE.EN],
  });
  return { paper, student, attemptId: attempt.id };
}

describe('AttemptPaperService — what a candidate is allowed to see', () => {
  it('never tells the student which option is correct', async () => {
    const { student, attemptId } = await sitting();

    const paper = await service.paper(student, attemptId);

    // The failure this prevents: `isCorrect` riding along in the options JSON to the browser.
    assert.ok(!JSON.stringify(paper).includes('isCorrect'));
    for (const served of paper.questions) {
      for (const option of served.options) {
        assert.deepEqual(Object.keys(option).sort(), ['id', 'position', 'text']);
      }
    }
  });

  it('leaves the SOLUTION behind, which explains the answer just as plainly', async () => {
    const { student, attemptId } = await sitting();

    const paper = await service.paper(student, attemptId);

    // The stem and the solution sit in one content object; only the stem is the student's to read.
    assert.deepEqual(Object.keys(paper.questions[0]?.content.en ?? {}), ['stem']);
    assert.ok(!JSON.stringify(paper).includes('Because.'));
  });

  it('carries no score or marks awarded either', async () => {
    const { student, attemptId } = await sitting();

    const serialized = JSON.stringify(await service.paper(student, attemptId));

    for (const leak of ['answerKey', 'marksAwarded', 'solution', 'correctCount']) {
      assert.ok(!serialized.includes(leak), `${leak} must not reach a candidate`);
    }
  });
});

describe('AttemptPaperService — the shape the screen draws from', () => {
  it('serves the questions in this student’s stored order', async () => {
    const { paper, student, attemptId } = await sitting();

    const served = await service.paper(student, attemptId);

    assert.deepEqual(
      served.questions.map((row) => [row.order, row.questionId]),
      paper.items.map((item, index) => [index + 1, item.questionId]),
    );
  });

  it('counts down to the server’s deadline and names the timing pattern', async () => {
    const { student, attemptId } = await sitting({
      timerTemplate: TIMER_TEMPLATE.SECTIONAL_LOCKED,
    });

    const paper = await service.paper(student, attemptId);

    assert.equal(paper.endsAt, ENDS_AT);
    assert.equal(paper.timerTemplate, TIMER_TEMPLATE.SECTIONAL_LOCKED);
    assert.deepEqual(
      paper.sections.map((section) => [section.name, section.questionCount, section.durationSec]),
      [['Reasoning', 2, 1200]],
    );
  });

  it('copies the marks the section set, per question', async () => {
    const { student, attemptId } = await sitting();

    const paper = await service.paper(student, attemptId);

    assert.deepEqual(
      paper.questions.map((row) => [row.marks, row.negativeMarks]),
      [
        [2, 0.5],
        [2, 0.5],
      ],
    );
  });

  /** The failure this prevents: a device clock ten minutes out sitting ten minutes more. */
  it('sends the server’s own now beside the deadline', async () => {
    const { student, attemptId } = await sitting();

    const before = Date.now();
    const stamped = Date.parse((await service.paper(student, attemptId)).serverNow);

    assert.ok(stamped >= before);
    assert.ok(stamped <= Date.now());
  });
});

describe('AttemptPaperService — language', () => {
  it('narrows to the one language a SINGLE sitting chose', async () => {
    const { student, attemptId } = await sitting({ languages: [LANGUAGE_CODE.HI] });

    const paper = await service.paper(student, attemptId);

    // A student sitting in Hindi is not handed the English paper alongside it.
    assert.deepEqual(Object.keys(paper.questions[0]?.content ?? {}), ['hi']);
    assert.deepEqual(Object.keys(paper.questions[0]?.options[0]?.text ?? {}), ['hi']);
  });

  it('carries both when the sitting is bilingual', async () => {
    const { student, attemptId } = await sitting({
      languages: [LANGUAGE_CODE.EN, LANGUAGE_CODE.HI],
      languageMode: LANGUAGE_MODE.DUAL,
    });

    const paper = await service.paper(student, attemptId);

    assert.deepEqual(Object.keys(paper.questions[0]?.content ?? {}).sort(), ['en', 'hi']);
    assert.equal(paper.languageMode, LANGUAGE_MODE.DUAL);
  });

  it('leaves out a language the question was never authored in', async () => {
    const { student, attemptId } = await sitting({
      languages: [LANGUAGE_CODE.EN, LANGUAGE_CODE.TE],
    });

    const paper = await service.paper(student, attemptId);

    // The stem has Telugu; the options do not, and an empty key would render as a blank option.
    assert.deepEqual(Object.keys(paper.questions[0]?.content ?? {}).sort(), ['en', 'te']);
    assert.deepEqual(Object.keys(paper.questions[0]?.options[0]?.text ?? {}), ['en']);
  });
});

describe('AttemptPaperService — images', () => {
  /** Stored before the write guard, content can quote any host, and every candidate would fetch it. */
  it('serves no image it did not sign itself', async () => {
    const { student, attemptId } = await sitting({
      stem: '<p>Look<img src="https://tracker.example/x.gif"></p>',
    });

    const paper = await service.paper(student, attemptId);

    assert.equal(paper.questions[0]?.content.en?.stem[0]?.text, '<p>Look</p>');
  });
});

describe('AttemptPaperService — whose sitting it is', () => {
  /** FORBIDDEN would confirm the id exists, which is a thing worth not confirming. */
  it('reads another student’s attempt, or one that does not exist, as missing', async () => {
    const { student, attemptId } = await sitting();
    const missing = (error: unknown) =>
      AppException.is(error) && error.code === ErrorCodes.NOT_FOUND;

    await assert.rejects(() => service.paper(uid(), attemptId), missing);
    await assert.rejects(() => service.paper(student, uid()), missing);
  });
});

describe('AttemptPaperService — a paper read twice', () => {
  const optionIds = (paper: { questions: { options: { id: string }[] }[] }) =>
    paper.questions.map((row) => row.options.map((option) => option.id));

  /** The failure this prevents: a student reloads mid-paper and the options move under them. */
  it('serves the same shuffled order every time, because a reload is not a new paper', async () => {
    const { student, attemptId } = await sitting();

    const first = await service.paper(student, attemptId);
    const again = await service.paper(student, attemptId);

    assert.deepEqual(optionIds(again), optionIds(first));
  });

  /** Scoring compares ids, never positions — which is what makes shuffling safe at all. */
  it('shuffles the options it was given rather than losing or inventing one', async () => {
    const { student, attemptId } = await sitting();

    const paper = await service.paper(student, attemptId);

    assert.deepEqual(
      optionIds(paper).map((ids) => [...ids].sort()),
      [LETTERS, LETTERS],
    );
  });
});

describe('AttemptPaperService and AttemptReportService — one derived order', () => {
  /** A seed that really reorders a 2+2-section paper — established by the score card's own test. */
  it('serves the exam paper in the same order the solutions review does, and not the paper’s own', async () => {
    const onPaper = await makePaper(prisma, {
      sections: ['Section A', 'Section B'],
      questions: [
        'Reasoning',
        'Reasoning',
        { subject: 'Reasoning', section: 1 },
        { subject: 'Reasoning', section: 1 },
      ],
    });
    await prisma.baseConfig.update({
      where: { id: onPaper.catalog.baseConfigId },
      data: { shuffleQuestions: true },
    });
    const student = (await makeStudent(prisma)).id;
    const attempt = await sitPaper(prisma, {
      paper: onPaper,
      studentId: student,
      chosen: [null, null, null, null],
      status: ATTEMPT_STATUS.EVALUATED,
      shuffleSeed: 1,
    });

    const paper = await service.paper(student, attempt.id);
    const solutions = await reports().solutions(student, attempt.id);

    const paperOrder = paper.questions.map((row) => row.questionId);
    const solutionOrder = solutions.questions.map((row) => row.questionId);
    assert.deepEqual(solutionOrder, paperOrder);
    assert.notDeepEqual(
      paperOrder,
      onPaper.items.map((item) => item.questionId),
    );
  });
});

/** What a configuration offers, which is what `languagesFor` narrows a shared paper down from. */
const offering = (onPaper: Awaited<ReturnType<typeof sitting>>['paper']) =>
  prisma.baseConfig.update({
    where: { id: onPaper.catalog.baseConfigId },
    data: { languages: [LANGUAGE_CODE.EN, LANGUAGE_CODE.HI, LANGUAGE_CODE.TE] },
  });

describe('AttemptPaperService — the paper held before a sitting exists', () => {
  /** The whole point of a shared paper: ordering it in the browser must land where the server would. */
  it('composes into exactly the paper a sitting is served', async () => {
    const { paper: onPaper, student, attemptId } = await sitting();
    await prisma.baseConfig.update({
      where: { id: onPaper.catalog.baseConfigId },
      // A real configuration declares what it offers; `languagesFor` resolves the shared paper from it.
      data: {
        shuffleQuestions: true,
        shuffleOptions: true,
        languages: [LANGUAGE_CODE.EN, LANGUAGE_CODE.HI, LANGUAGE_CODE.TE],
      },
    });
    const { shuffleSeed } = await prisma.attempt.findUniqueOrThrow({
      where: { id: attemptId },
      select: { shuffleSeed: true },
    });

    const served = await service.paper(student, attemptId);
    const shared = await service.testPaper(student, onPaper.testId, [LANGUAGE_CODE.EN]);

    assert.deepEqual(
      servedQuestions(
        shared.questions,
        shuffleSeed,
        shared.shuffleQuestions,
        shared.shuffleOptions,
      ),
      served.questions,
    );
  });

  it('carries no sitting of its own, so nothing about one can leak through it', async () => {
    const { paper: onPaper, student } = await sitting();
    await offering(onPaper);

    const shared = await service.testPaper(student, onPaper.testId, [LANGUAGE_CODE.EN]);

    for (const key of ['attemptId', 'endsAt', 'serverNow']) {
      assert.equal(key in shared, false, `the shared paper carries ${key}`);
    }
  });

  /** The bug this prevents: a shared paper answering with every language a question was authored in. */
  it('narrows to the languages asked for, as the paper of a sitting does', async () => {
    const { paper: onPaper, student } = await sitting({ languageMode: LANGUAGE_MODE.SINGLE });
    await offering(onPaper);

    const shared = await service.testPaper(student, onPaper.testId, [LANGUAGE_CODE.HI]);

    assert.deepEqual(shared.languages, [LANGUAGE_CODE.HI]);
    // Content is keyed by the lowercase language, so the one key is the one code asked for.
    assert.deepEqual(Object.keys(shared.questions[0]?.content ?? {}), [
      LANGUAGE_CODE.HI.toLowerCase(),
    ]);
  });
});
