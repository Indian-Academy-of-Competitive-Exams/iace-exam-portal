import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { paperCompletenessIssues } from '../src/tests/test-rules';

describe('paperCompletenessIssues', () => {
  const sections = [{ id: 'sec_1', name: 'Reasoning', questionCount: 1 }];

  /** The foreign key keeps this out of Postgres today; the rule is what still holds if it moves. */
  it('names a paper row for a section the configuration no longer has', () => {
    assert.deepEqual(paperCompletenessIssues(sections, ['sec_1', 'sec_gone']), [
      'The paper holds questions for a section this configuration no longer has.',
    ]);
  });
});
