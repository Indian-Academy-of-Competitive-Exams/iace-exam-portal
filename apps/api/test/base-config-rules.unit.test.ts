import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EXAM_TEMPLATE, TEST_UI } from '@iace/contracts';
import { renderModeIssue } from '../src/configs/base-config-rules';

describe('renderModeIssue', () => {
  it('refuses a bubble sheet on a skin that cannot draw one', () => {
    const issue = renderModeIssue(EXAM_TEMPLATE.SSC_RAILWAYS, TEST_UI.OMR);

    assert.ok(issue, 'an OMR paper on the railway template must be refused');
    assert.match(issue, /default template/i);
  });

  it('allows a bubble sheet on the default template', () => {
    assert.equal(renderModeIssue(EXAM_TEMPLATE.DEFAULT, TEST_UI.OMR), null);
  });

  it('leaves an on-screen paper alone on every template', () => {
    for (const template of [EXAM_TEMPLATE.DEFAULT, EXAM_TEMPLATE.SSC_RAILWAYS]) {
      assert.equal(renderModeIssue(template, TEST_UI.CBT), null);
    }
  });
});
