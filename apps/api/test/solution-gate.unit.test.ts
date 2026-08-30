import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EVALUATION_MODE } from '@iace/contracts';
import {
  SOLUTIONS_OPENING,
  solutionsAreOpen,
  solutionsClosedReason,
  solutionsOpenAt,
  solutionsOpening,
  type SolutionGateFacts,
} from '../src/attempts/solution-gate';

const NOW = new Date('2026-09-01T12:00:00.000Z');
const HOUR = 3_600_000;

function facts(overrides: Partial<SolutionGateFacts> = {}): SolutionGateFacts {
  return {
    evaluationMode: EVALUATION_MODE.RANKED,
    scheduled: true,
    closesAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(),
    durationSec: 3600,
    extraTimeSec: 0,
    ...overrides,
  };
}

describe('the solution gate', () => {
  it('opens a practice paper the moment it is marked', () => {
    const practice = facts({ evaluationMode: EVALUATION_MODE.PRACTICE, closesAt: null });

    assert.equal(solutionsOpening(practice).state, SOLUTIONS_OPENING.NOW);
    assert.equal(solutionsAreOpen(practice, NOW), true);
  });

  it('opens a standalone paper immediately, because no cohort is sitting it together', () => {
    const standalone = facts({ scheduled: false, closesAt: null });

    assert.equal(solutionsAreOpen(standalone, NOW), true);
  });

  /** The failure this prevents: handing the key to one student while another is still writing. */
  it('holds a scheduled paper shut until entry has closed AND the last sitting has ended', () => {
    const stillWriting = facts({ closesAt: new Date(NOW.getTime() - 30 * 60_000).toISOString() });
    const finished = facts({ closesAt: new Date(NOW.getTime() - 2 * HOUR).toISOString() });

    assert.equal(solutionsAreOpen(stillWriting, NOW), false);
    assert.equal(solutionsAreOpen(finished, NOW), true);
  });

  it('counts the extra time a branch granted before it opens', () => {
    const closesAt = new Date(NOW.getTime() - 70 * 60_000).toISOString();

    assert.equal(solutionsAreOpen(facts({ closesAt }), NOW), true);
    assert.equal(solutionsAreOpen(facts({ closesAt, extraTimeSec: 900 }), NOW), false);
  });

  it('refuses a scheduled paper nobody has capped entry on, and names no date it cannot keep', () => {
    const uncapped = facts({ closesAt: null });

    assert.equal(solutionsOpening(uncapped).state, SOLUTIONS_OPENING.SHUT);
    assert.equal(solutionsAreOpen(uncapped, NOW), false);
    assert.equal(solutionsOpenAt(uncapped), null);
    assert.match(solutionsClosedReason(uncapped), /closed for everyone/);
  });

  it('names the instant it will open where one exists', () => {
    const soon = facts({ closesAt: new Date(NOW.getTime() + HOUR).toISOString() });

    assert.equal(solutionsOpenAt(soon), new Date(NOW.getTime() + 2 * HOUR).toISOString());
    assert.match(solutionsClosedReason(soon), /last sitting/);
  });

  it('opens exactly at the instant, not a moment after it', () => {
    const at = facts({ closesAt: new Date(NOW.getTime() - HOUR).toISOString() });

    assert.equal(solutionsAreOpen(at, NOW), true);
    assert.equal(solutionsAreOpen(at, new Date(NOW.getTime() - 1)), false);
  });
});
