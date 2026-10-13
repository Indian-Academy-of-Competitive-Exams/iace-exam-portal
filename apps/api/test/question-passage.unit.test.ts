import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { opensWithPassage } from '../src/questions/question-passage';

describe('opensWithPassage', () => {
  it('sees a passage typed above its question, parted by a blank line', () => {
    assert.equal(
      opensWithPassage('<p>Directions: read the table.</p><p></p><p>What is the total?</p>'),
      true,
    );
  });

  it('judges the opening by what stands before the FIRST blank line', () => {
    const cell =
      '<p>What is the profit in 2020?</p><p><br></p><p>Study the following note.</p><p></p><p>Ignore tax.</p>';
    assert.equal(opensWithPassage(cell), false);
  });

  it('does not take a question that only begins like one, with no blank line under it', () => {
    assert.equal(opensWithPassage('<p>Read the following and pick the odd one out.</p>'), false);
  });

  it('does not take an opening with nothing asked beneath it', () => {
    assert.equal(opensWithPassage('<p>Passage</p><p></p><p>&nbsp;</p>'), false);
  });
});
