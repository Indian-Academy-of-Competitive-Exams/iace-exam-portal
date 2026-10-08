import {
  CONFIG_TOTAL_MARKS_MAX,
  EXAM_TEMPLATE,
  TEST_UI,
  TIMER_TEMPLATE,
  configTotalsOf,
  type BaseConfigModuleDraft,
  type BaseConfigSectionDraft,
  type ExamTemplate,
  type TestUi,
  type TimerTemplate,
  type UpdateBaseConfigBody,
} from '@iace/contracts';
import { SECONDS_PER_MINUTE } from '../common/time/units';

/** The rules that keep a blueprint honest — pure, so they are testable without a database. */

/** The three fields a locked config may still change. Everything else is its SHAPE, which a finalized paper was frozen against. Not a loophole: a stage holds one default, so promoting a clone means clearing `isDefault` on the locked original it replaces. */
export const UNFROZEN_FIELDS = ['name', 'isDefault', 'isActive'] as const;

export const INACTIVE_CONFIG_MESSAGE =
  'That config is retired. Pick another, or reactivate it first.';

export const BUILT_ON_CONFIG_MESSAGE =
  'Tests are built on this config, so its sections stay as they are. Clone it to change them; the clone starts where this one left off.';

export const LOCKED_CONFIG_MESSAGE =
  'This config is locked, because a test built from it has already been sat. Clone it to change its shape; the clone starts where this one left off.';

/** Carried by every save and changing nothing — a locked config may still be renamed with it. */
const NOT_A_FIELD = ['expectedUpdatedAt'] as const;

/** What a save is asking to change, once the unfrozen three are set aside. */
export function locksOutEdit(input: UpdateBaseConfigBody): boolean {
  const unfrozen = new Set<string>([...UNFROZEN_FIELDS, ...NOT_A_FIELD]);
  return Object.keys(input).some((key) => !unfrozen.has(key));
}

export const OMR_IS_DEFAULT_ONLY_MESSAGE =
  'An OMR sheet is only drawn by the default template. Set the template to Default, or answer on screen.';

/** A bubble sheet is the default template's affordance; no other skin draws one. */
export function renderModeIssue(examTemplate: ExamTemplate, defaultTestUi: TestUi): string | null {
  const mismatched = defaultTestUi === TEST_UI.OMR && examTemplate !== EXAM_TEMPLATE.DEFAULT;
  return mismatched ? OMR_IS_DEFAULT_ONLY_MESSAGE : null;
}

/** The shape rules the database also enforces as deferred constraint triggers. Checked here too so the admin gets a field error rather than a raw Postgres exception at commit. */
export function configShapeIssues(
  timerTemplate: TimerTemplate,
  sections: readonly BaseConfigSectionDraft[],
  modules: readonly BaseConfigModuleDraft[],
  durationSec?: number,
): string[] {
  const issues = [
    ...sectionalIssues(timerTemplate, sections, durationSec),
    ...perQuestionIssues(timerTemplate, sections),
    ...sessionIssues(timerTemplate, modules, durationSec),
    ...totalMarksIssues(sections),
  ];

  if (timerTemplate !== TIMER_TEMPLATE.SESSION_MODULE_LOCKED && modules.length > 0) {
    issues.push('Only a session paper has sessions. Change the timer, or remove them.');
  }

  const orders = sections.map((section) => section.order);
  if (new Set(orders).size !== orders.length) {
    issues.push('Two sections share a position. Each one sits at its own.');
  }

  return issues;
}

/** Every section carries a clock, and the paper's own is their sum — not more, not less. */
function sectionalIssues(
  timerTemplate: TimerTemplate,
  sections: readonly BaseConfigSectionDraft[],
  durationSec?: number,
): string[] {
  if (timerTemplate !== TIMER_TEMPLATE.SECTIONAL_LOCKED) return [];

  const untimed = sections.filter((section) => !section.durationSec);
  if (untimed.length > 0) {
    return [
      `A sectional paper gives every section its own clock, and ${untimed.map((section) => section.name).join(', ')} has no time.`,
    ];
  }
  // The section clocks are the ones a candidate sits, so the paper's own has to be their sum.
  return clockIssue('sections', sections, durationSec, (clocked, paper) => clocked !== paper);
}

/** Every question counts down on its own, so every section says how long its questions get. */
function perQuestionIssues(
  timerTemplate: TimerTemplate,
  sections: readonly BaseConfigSectionDraft[],
): string[] {
  if (timerTemplate !== TIMER_TEMPLATE.PER_ITEM_TIMED) return [];

  const untimed = sections.filter((section) => !section.perQuestionSec);
  if (untimed.length === 0) return [];
  return [
    `A per-question paper gives every question its own countdown, and ${untimed.map((section) => section.name).join(', ')} has no seconds per question.`,
  ];
}

/** The total is a cache in a column of its own, narrower than the sections can add up to. */
function totalMarksIssues(sections: readonly BaseConfigSectionDraft[]): string[] {
  const { totalMarks } = configTotalsOf(sections);
  if (totalMarks <= CONFIG_TOTAL_MARKS_MAX) return [];
  return [
    `The sections add up to ${marks(totalMarks)} marks, and a paper holds at most ${marks(CONFIG_TOTAL_MARKS_MAX)}.`,
  ];
}

const marks = (value: number) => value.toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** A module's clock is optional, so the total is judged for an overrun and never for a match. */
function sessionIssues(
  timerTemplate: TimerTemplate,
  modules: readonly BaseConfigModuleDraft[],
  durationSec?: number,
): string[] {
  if (timerTemplate !== TIMER_TEMPLATE.SESSION_MODULE_LOCKED) return [];
  if (modules.length === 0) return ['A session paper needs at least one session.'];

  return clockIssue('sessions', modules, durationSec, (clocked, paper) => clocked > paper);
}

/** Both templates say it the same way, so the wording cannot drift between them. */
function clockIssue(
  noun: string,
  parts: readonly { durationSec?: number | null }[],
  durationSec: number | undefined,
  wrong: (clocked: number, paper: number) => boolean,
): string[] {
  if (durationSec === undefined) return [];

  const clocked = parts.reduce((sum, part) => sum + (part.durationSec ?? 0), 0);
  return wrong(clocked, durationSec)
    ? [
        `The ${noun} add up to ${clockLabel(clocked)}, but the paper is set to ${clockLabel(durationSec)}.`,
      ]
    : [];
}

const counted = (count: number, unit: string) => `${count} ${unit}${count === 1 ? '' : 's'}`;

/** Said in what the reader set it in, minutes, with the seconds left over so two clocks that differ never read the same. */
function clockLabel(seconds: number): string {
  const whole = counted(Math.floor(seconds / SECONDS_PER_MINUTE), 'minute');
  const rest = seconds % SECONDS_PER_MINUTE;
  return rest === 0 ? whole : `${whole} ${counted(rest, 'second')}`;
}

/** A config with tests built from it is history — deleting it would orphan every one of them. */
export function configDeletionBlocker(usage: {
  locked: boolean;
  testCount: number;
  cloneCount: number;
}): string | null {
  if (usage.locked) {
    return 'This config is locked, so a test built from it has already been sat. Retire it instead. It keeps its history and is simply no longer offered.';
  }
  if (usage.testCount > 0) {
    const tests = `${usage.testCount} test${usage.testCount === 1 ? '' : 's'}`;
    return `${tests} inherit their shape from this config. Retire it instead. A retired config keeps everything it has and is simply no longer offered.`;
  }
  if (usage.cloneCount > 0) {
    const clones = usage.cloneCount === 1 ? '1 config was' : `${usage.cloneCount} configs were`;
    return `${clones} cloned from this one. Retire it instead. A retired config keeps everything it has and is simply no longer offered.`;
  }
  return null;
}
