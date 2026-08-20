import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  examDeletionBlocker,
  examEditBlocker,
  stageDeletionBlocker,
  stageEditBlocker,
  type ExamUsage,
} from '../src/configs/exam-rules';

const unused: ExamUsage = { stageCount: 0, studentCount: 0 };

describe('examDeletionBlocker', () => {
  it('allows deleting an exam nothing points at', () => {
    assert.equal(examDeletionBlocker(unused), null);
  });

  /**
   * The failure this exists to prevent: a stage carries the base configs, series and tests built
   * on it, so one delete would take far more than the row the admin is looking at.
   */
  it('refuses one that still has stages, and says how many', () => {
    assert.match(examDeletionBlocker({ ...unused, stageCount: 2 }) ?? '', /2 stages/);
  });

  it('refuses one students are still enrolled on', () => {
    assert.match(examDeletionBlocker({ ...unused, studentCount: 7 }) ?? '', /7 enrolled students/);
  });

  it('names every holder at once, so the admin is not told one at a time', () => {
    const blocker = examDeletionBlocker({ stageCount: 3, studentCount: 40 }) ?? '';
    assert.match(blocker, /3 stages/);
    assert.match(blocker, /40 enrolled students/);
  });

  it('reads naturally for a single stage', () => {
    assert.match(examDeletionBlocker({ ...unused, stageCount: 1 }) ?? '', /1 stage\b/);
  });

  it('offers retiring as the way out', () => {
    assert.match(examDeletionBlocker({ ...unused, stageCount: 1 }) ?? '', /[Rr]etire/);
  });
});

describe('examEditBlocker', () => {
  it('leaves everything but a code change alone, however much is attached', () => {
    const busy = { studentCount: 400 };
    assert.equal(examEditBlocker(busy, {}), null);
  });

  it('allows a code change while nobody is enrolled on it', () => {
    assert.equal(examEditBlocker(unused, { code: 'SSC CHSL' }), null);
  });

  /** CODE is stored as free text with no FK — changing it detaches every enrolment silently. */
  it('refuses a code change once students are enrolled under it', () => {
    const blocker = examEditBlocker({ studentCount: 118 }, { code: 'SSC CHSL' });
    assert.match(blocker ?? '', /118 enrolled students/);
    assert.match(blocker ?? '', /detach/);
  });

  it('uses the singular verb for a single enrolled student', () => {
    const blocker = examEditBlocker({ studentCount: 1 }, { code: 'SSC CHSL' });
    assert.match(blocker ?? '', /1 enrolled student already holds this code/);
  });
});

describe('stageDeletionBlocker', () => {
  const empty = { configCount: 0, testCount: 0, seriesCount: 0 };

  it('allows deleting a stage nothing hangs off', () => {
    assert.equal(stageDeletionBlocker(empty), null);
  });

  it('names every holder at once, so the admin is not told one at a time', () => {
    const blocker = stageDeletionBlocker({ configCount: 1, testCount: 3, seriesCount: 2 }) ?? '';
    assert.match(blocker, /1 base config\b/);
    assert.match(blocker, /3 tests/);
    assert.match(blocker, /2 series/);
  });

  /** "Serieses" is not a word, and a message that invents one reads as a bug. */
  it('leaves an already-plural noun alone', () => {
    assert.match(stageDeletionBlocker({ ...empty, seriesCount: 1 }) ?? '', /1 series\b/);
    assert.doesNotMatch(stageDeletionBlocker({ ...empty, seriesCount: 4 }) ?? '', /seriess/);
  });

  it('offers retiring as the way out', () => {
    assert.match(stageDeletionBlocker({ ...empty, testCount: 1 }) ?? '', /[Rr]etire/);
  });
});

describe('stageEditBlocker', () => {
  it('leaves everything but a key change alone', () => {
    assert.equal(stageEditBlocker({ configCount: 9 }, {}), null);
  });

  it('allows a key change while no base config hangs off it', () => {
    assert.equal(stageEditBlocker({ configCount: 0 }, { stageKey: 'SSC_CGL_P1' }), null);
  });

  /** The key is what a seed script addresses a stage by, with no foreign key behind it. */
  it('refuses a key change once a base config hangs off it', () => {
    const blocker = stageEditBlocker({ configCount: 2 }, { stageKey: 'SSC_CGL_P1' });
    assert.match(blocker ?? '', /2 base configs/);
    assert.match(blocker ?? '', /detach/);
  });
});
