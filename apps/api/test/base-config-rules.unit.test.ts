import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EXAM_TEMPLATE,
  TEST_UI,
  TIMER_TEMPLATE,
  TYPING_PRESET_KEY,
  type BaseConfigSectionDraft,
} from '@iace/contracts';
import { configShapeIssues, renderModeIssue } from '../src/configs/base-config-rules';

const section = (over: Partial<BaseConfigSectionDraft> = {}): BaseConfigSectionDraft => ({
  name: 'Reasoning',
  order: 0,
  questionCount: 25,
  marksPerQuestion: 2,
  negativeMarks: 0.5,
  ...over,
});

describe('configShapeIssues — a per-question paper', () => {
  /** The failure this prevents: only the database's deferred trigger refusing it, as a 500 at commit. */
  it('names the section that has no seconds per question', () => {
    const issues = configShapeIssues(
      TIMER_TEMPLATE.PER_ITEM_TIMED,
      [section({ perQuestionSec: 45 }), section({ name: 'English', order: 1 })],
      [],
      3600,
    );

    assert.equal(issues.length, 1);
    assert.match(issues[0] ?? '', /English/);
    assert.doesNotMatch(issues[0] ?? '', /Reasoning/);
  });

  it('takes one whose every section carries its seconds, and asks nothing of another template', () => {
    const timed = [section({ perQuestionSec: 45 })];

    assert.deepEqual(configShapeIssues(TIMER_TEMPLATE.PER_ITEM_TIMED, timed, [], 3600), []);
    assert.deepEqual(configShapeIssues(TIMER_TEMPLATE.COMPOSITE_FREE, [section()], [], 3600), []);
  });
});

describe('configShapeIssues — the total a paper can hold', () => {
  const full = (name: string, order: number) =>
    section({ name, order, questionCount: 500, marksPerQuestion: 999.99 });

  /** The failure this prevents: three full sections overflowing the totalMarks column at commit. */
  it('refuses marks that add up past the column, and says both figures', () => {
    const issues = configShapeIssues(
      TIMER_TEMPLATE.COMPOSITE_FREE,
      [full('A', 0), full('B', 1), full('C', 2)],
      [],
      3600,
    );

    assert.equal(issues.length, 1);
    assert.match(issues[0] ?? '', /14,99,985 marks/);
    assert.match(issues[0] ?? '', /at most 9,99,999\.99/);
  });

  it('takes a paper inside it', () => {
    const paper = [full('A', 0), full('B', 1)];

    assert.deepEqual(configShapeIssues(TIMER_TEMPLATE.COMPOSITE_FREE, paper, [], 3600), []);
  });
});

describe('configShapeIssues — the clocks of a sectional paper', () => {
  const clocked = (order: number, durationSec: number) =>
    section({ name: `Section ${order + 1}`, order, durationSec });

  /** The failure this prevents: 59.99 against 60 read back as "60 minutes, but the paper is set to 60 minutes". */
  it('says a total that is not whole minutes with its seconds', () => {
    const [issue] = configShapeIssues(
      TIMER_TEMPLATE.SECTIONAL_LOCKED,
      [clocked(0, 1200), clocked(1, 1200), clocked(2, 1199)],
      [],
      3600,
    );

    assert.match(issue ?? '', /59 minutes 59 seconds/);
    assert.match(issue ?? '', /set to 60 minutes\./);
  });

  it('takes sections that add up to the paper exactly', () => {
    const paper = [clocked(0, 1200), clocked(1, 1200), clocked(2, 1200)];

    assert.deepEqual(configShapeIssues(TIMER_TEMPLATE.SECTIONAL_LOCKED, paper, [], 3600), []);
  });
});

describe('renderModeIssue', () => {
  it('refuses a bubble sheet on a skin that cannot draw one', () => {
    const issue = renderModeIssue(EXAM_TEMPLATE.RAILWAYS, TEST_UI.OMR);

    assert.ok(issue, 'an OMR paper on the railway template must be refused');
    assert.match(issue, /default template/i);
  });

  it('allows a bubble sheet on the default template', () => {
    assert.equal(renderModeIssue(EXAM_TEMPLATE.DEFAULT, TEST_UI.OMR), null);
  });

  it('leaves an on-screen paper alone on every template', () => {
    for (const template of [EXAM_TEMPLATE.DEFAULT, EXAM_TEMPLATE.RAILWAYS]) {
      assert.equal(renderModeIssue(template, TEST_UI.CBT), null);
    }
  });
});

describe('configShapeIssues — a typing section', () => {
  const TEN_MINUTES = 600;
  const typing = (over: Partial<BaseConfigSectionDraft> = {}) =>
    section({
      name: 'Typing',
      questionCount: 1,
      marksPerQuestion: 0,
      negativeMarks: 0,
      typingPreset: TYPING_PRESET_KEY.SSC_CHSL_TYPING_EN,
      ...over,
    });

  it('takes a paper that is the typing test alone, on a clock of the standard’s length', () => {
    assert.deepEqual(
      configShapeIssues(TIMER_TEMPLATE.COMPOSITE_FREE, [typing()], [], TEN_MINUTES),
      [],
    );
  });

  it('refuses a clock that is not the standard’s, which would score a speed nobody typed at', () => {
    const [issue, ...rest] = configShapeIssues(TIMER_TEMPLATE.COMPOSITE_FREE, [typing()], [], 900);

    assert.match(issue ?? '', /10 minutes/);
    assert.match(issue ?? '', /15 minutes/);
    assert.deepEqual(rest, []);
  });

  it('refuses a typing section that carries marks or more than its one passage', () => {
    const marked = configShapeIssues(
      TIMER_TEMPLATE.COMPOSITE_FREE,
      [typing({ marksPerQuestion: 2 })],
      [],
      TEN_MINUTES,
    );
    const several = configShapeIssues(
      TIMER_TEMPLATE.COMPOSITE_FREE,
      [typing({ questionCount: 2 })],
      [],
      TEN_MINUTES,
    );

    assert.equal(marked.length, 1);
    assert.equal(several.length, 1);
  });

  it('refuses one sharing a composite paper, where it would have no clock of its own', () => {
    const issues = configShapeIssues(
      TIMER_TEMPLATE.COMPOSITE_FREE,
      [section(), typing({ order: 1 })],
      [],
      3600,
    );

    assert.equal(issues.length, 1);
    assert.match(issues[0] ?? '', /only section/);
  });

  it('takes one as a section of a sectional paper, timed by its own clock', () => {
    const paper = [section({ durationSec: 3000 }), typing({ order: 1, durationSec: TEN_MINUTES })];

    assert.deepEqual(configShapeIssues(TIMER_TEMPLATE.SECTIONAL_LOCKED, paper, [], 3600), []);
  });

  it('takes one alone in its session, and refuses one that shares it', () => {
    const sessions = [
      { name: 'Session I', order: 0, durationSec: 3000 },
      { name: 'Session II', order: 1, durationSec: TEN_MINUTES },
    ];
    const alone = [section({ moduleOrder: 0 }), typing({ order: 1, moduleOrder: 1 })];
    const shared = [section({ moduleOrder: 1 }), typing({ order: 1, moduleOrder: 1 })];

    assert.deepEqual(
      configShapeIssues(TIMER_TEMPLATE.SESSION_MODULE_LOCKED, alone, sessions, 3600),
      [],
    );
    assert.match(
      configShapeIssues(TIMER_TEMPLATE.SESSION_MODULE_LOCKED, shared, sessions, 3600)[0] ?? '',
      /alone in its session/,
    );
  });
});
