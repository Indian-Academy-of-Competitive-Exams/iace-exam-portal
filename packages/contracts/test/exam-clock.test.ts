import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ANSWER_STATE,
  clockText,
  nextOpenSectionId,
  nextQuestionId,
  openSections,
  paletteCounts,
  sectionEffort,
  type AnswerState,
  secondsLeft,
  type ExamClock,
} from '../src/index';

const clock = (over: Partial<ExamClock> = {}): ExamClock => ({
  endsAt: '2026-09-01T06:00:00.000Z',
  serverNow: '2026-09-01T05:00:00.000Z',
  arrivedAt: 1_000_000,
  ...over,
});

describe('secondsLeft', () => {
  it('counts the sitting the server granted, not the wall clock', () => {
    assert.equal(secondsLeft(clock(), 1_000_000), 3600);
  });

  it('ticks down with the page, second by second', () => {
    assert.equal(secondsLeft(clock(), 1_000_000 + 90_000), 3510);
  });

  /** The failure this prevents: a device set an hour fast handing back a sitting an hour short. */
  it('ignores a device clock that disagrees with the server', () => {
    const skewed = clock({ arrivedAt: 9_999_999_999 });

    assert.equal(secondsLeft(skewed, 9_999_999_999), 3600);
  });

  it('floors at zero rather than running negative', () => {
    assert.equal(secondsLeft(clock(), 1_000_000 + 7_200_000), 0);
  });

  /** A reload mid-sitting must recover the time left, not restart it. */
  it('recovers the same remaining time from a fresh paper', () => {
    const resumed = clock({ serverNow: '2026-09-01T05:40:00.000Z', arrivedAt: 5_000_000 });

    assert.equal(secondsLeft(resumed, 5_000_000), 1200);
  });
});

describe('clockText', () => {
  it('drops the hour once there is none left', () => {
    assert.equal(clockText(3723), '1:02:03');
    assert.equal(clockText(598), '09:58');
    assert.equal(clockText(0), '00:00');
  });
});

describe('paletteCounts', () => {
  it('counts every question exactly once', () => {
    const counts = paletteCounts(['q1', 'q2', 'q3', 'q4'], {
      q1: { state: ANSWER_STATE.ANSWERED },
      q2: { state: ANSWER_STATE.ANSWERED_MARKED },
      q3: { state: ANSWER_STATE.NOT_ANSWERED },
    });

    assert.equal(counts.ANSWERED, 1);
    assert.equal(counts.ANSWERED_MARKED, 1);
    assert.equal(counts.NOT_ANSWERED, 1);
    // The one the state map never mentions is the one nobody has opened.
    assert.equal(counts.NOT_VISITED, 1);
    assert.equal(
      Object.values(counts).reduce((sum, n) => sum + n, 0),
      4,
    );
  });
});

describe('openSections', () => {
  const sections = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('opens every section under one composite clock', () => {
    assert.deepEqual(openSections(sections, false, {}), ['a', 'b', 'c']);
  });

  /** The failure this prevents: a sectional paper letting a student back into a closed section. */
  it('opens only the current one under a sectional clock', () => {
    assert.deepEqual(openSections(sections, true, { a: { closed: true } }), ['b']);
  });

  it('opens nothing once every section has closed', () => {
    const allClosed = { a: { closed: true }, b: { closed: true }, c: { closed: true } };

    assert.deepEqual(openSections(sections, true, allClosed), []);
  });
});

describe('nextQuestionId', () => {
  const paper = ['q1', 'q2', 'q3'];

  it('moves to the seat after this one', () => {
    assert.equal(nextQuestionId(paper, 'q2'), 'q3');
  });

  /** The failure this prevents: the last question having no Next, so a review pass dead-ends. */
  it('wraps round from the last back to the first', () => {
    assert.equal(nextQuestionId(paper, 'q3'), 'q1');
  });

  it('opens the first when nothing is open yet', () => {
    assert.equal(nextQuestionId(paper, null), 'q1');
  });

  it('has nowhere to go in an empty section', () => {
    assert.equal(nextQuestionId([], 'q1'), null);
  });
});

describe('nextOpenSectionId', () => {
  const sections = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('hands over to the first section still open', () => {
    assert.equal(nextOpenSectionId(sections, { a: { closed: true } }, 'a'), 'b');
  });

  /** The failure this prevents: a closing section handing back to itself and never ending. */
  it('never hands back to the section being left', () => {
    assert.equal(nextOpenSectionId(sections, { b: { closed: true } }, 'b'), 'a');
  });

  it('says nowhere once every other section has closed', () => {
    const closed = { a: { closed: true }, b: { closed: true }, c: { closed: true } };

    assert.equal(nextOpenSectionId(sections, closed, 'c'), null);
  });
});

describe('what a sitting knows about itself the moment it ends', () => {
  const sections = [
    {
      id: 'sec_quant',
      name: 'Quantitative Aptitude',
      order: 1,
      questionCount: 3,
      durationSec: null,
    },
    { id: 'sec_reason', name: 'Reasoning', order: 2, questionCount: 2, durationSec: null },
  ];
  const questions = [
    { questionId: 'q1', baseConfigSectionId: 'sec_quant' },
    { questionId: 'q2', baseConfigSectionId: 'sec_quant' },
    { questionId: 'q3', baseConfigSectionId: 'sec_quant' },
    { questionId: 'q4', baseConfigSectionId: 'sec_reason' },
    { questionId: 'q5', baseConfigSectionId: 'sec_reason' },
  ];

  it('reports one row per section, in the papered order, under the section its own name', () => {
    const effort = sectionEffort(sections, questions, {});
    assert.deepEqual(
      effort.map((row) => [row.id, row.name, row.total]),
      [
        ['sec_quant', 'Quantitative Aptitude', 3],
        ['sec_reason', 'Reasoning', 2],
      ],
    );
  });

  /** Attempted means a real answer. A flagged question with none scores as unattempted, so it reads as one. */
  it('counts only a real answer as attempted', () => {
    const effort = sectionEffort(sections, questions, {
      q1: { state: ANSWER_STATE.ANSWERED },
      q2: { state: ANSWER_STATE.ANSWERED_MARKED },
      q3: { state: ANSWER_STATE.MARKED_REVIEW },
      q4: { state: ANSWER_STATE.NOT_ANSWERED },
    });

    assert.deepEqual(effort[0], {
      id: 'sec_quant',
      name: 'Quantitative Aptitude',
      total: 3,
      attempted: 2,
      unattempted: 1,
    });
    assert.deepEqual(effort[1], {
      id: 'sec_reason',
      name: 'Reasoning',
      total: 2,
      attempted: 0,
      unattempted: 2,
    });
  });

  /** The two numbers are the section, so a screen showing both can never leave a question out. */
  it('always splits the section in two', () => {
    const cases: Record<string, { state: AnswerState }>[] = [
      {},
      { q1: { state: ANSWER_STATE.ANSWERED } },
    ];
    for (const answers of cases) {
      for (const row of sectionEffort(sections, questions, answers)) {
        assert.equal(row.attempted + row.unattempted, row.total, row.name);
      }
    }
  });

  /** A scoped or drawn paper serves what it serves; the blueprint's count is not this student's. */
  it('counts the questions actually served, not the ones the blueprint asked for', () => {
    const served = questions.filter((row) => row.questionId !== 'q3');
    assert.equal(sectionEffort(sections, served, {})[0]?.total, 2);
  });

  it('leaves out a section this paper served nothing from', () => {
    const quantOnly = questions.filter((row) => row.baseConfigSectionId === 'sec_quant');
    assert.deepEqual(
      sectionEffort(sections, quantOnly, {}).map((row) => row.id),
      ['sec_quant'],
    );
  });
});
