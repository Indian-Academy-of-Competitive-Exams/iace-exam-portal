import {
  TIMER_TEMPLATE,
  type BaseConfigModuleDraft,
  type BaseConfigSectionDraft,
  type TimerTemplate,
  type UpdateBaseConfigBody,
} from '@iace/contracts';

/** The rules that keep a blueprint honest — pure, so they are testable without a database. */

/**
 * The three fields a locked config may still change. Everything else is its SHAPE, which a
 * finalized paper was frozen against. Not a loophole: a stage holds one default, so promoting a
 * clone means clearing `isDefault` on the locked original it replaces.
 */
export const UNFROZEN_FIELDS = ['name', 'isDefault', 'isActive'] as const;

export const LOCKED_CONFIG_MESSAGE =
  'This config is locked — a test built from it has already been sat. Clone it to change its shape; the clone starts where this one left off.';

/** What a save is asking to change, once the unfrozen three are set aside. */
export function locksOutEdit(input: UpdateBaseConfigBody): boolean {
  const unfrozen = new Set<string>(UNFROZEN_FIELDS);
  return Object.keys(input).some((key) => !unfrozen.has(key));
}

/**
 * The shape rules the database also enforces as deferred constraint triggers. Checked here too so
 * the admin gets a field error rather than a raw Postgres exception at commit.
 */
export function configShapeIssues(
  timerTemplate: TimerTemplate,
  sections: readonly BaseConfigSectionDraft[],
  modules: readonly BaseConfigModuleDraft[],
): string[] {
  const issues: string[] = [];

  if (timerTemplate === TIMER_TEMPLATE.SECTIONAL_LOCKED) {
    const untimed = sections.filter((section) => !section.durationSec);
    if (untimed.length > 0) {
      issues.push(
        `A sectional paper gives every section its own clock — ${untimed.map((section) => section.name).join(', ')} has no time.`,
      );
    }
  }

  if (timerTemplate === TIMER_TEMPLATE.SESSION_MODULE_LOCKED && modules.length === 0) {
    issues.push('A session paper is made of modules — add at least one.');
  }

  if (timerTemplate !== TIMER_TEMPLATE.SESSION_MODULE_LOCKED && modules.length > 0) {
    issues.push('Only a session paper has modules. Change the timer, or remove them.');
  }

  const orders = sections.map((section) => section.order);
  if (new Set(orders).size !== orders.length) {
    issues.push('Two sections share a position. Each one sits at its own.');
  }

  return issues;
}

/** A config with tests built from it is history — deleting it would orphan every one of them. */
export function configDeletionBlocker(usage: {
  locked: boolean;
  testCount: number;
}): string | null {
  if (usage.locked) {
    return 'This config is locked, so a test built from it has already been sat. Retire it instead — it keeps its history and is simply no longer offered.';
  }
  if (usage.testCount > 0) {
    const tests = `${usage.testCount} test${usage.testCount === 1 ? '' : 's'}`;
    return `${tests} inherit their shape from this config. Retire it instead — a retired config keeps everything it has and is simply no longer offered.`;
  }
  return null;
}
