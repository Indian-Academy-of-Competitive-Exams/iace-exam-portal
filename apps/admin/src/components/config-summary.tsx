import { type BaseConfigDetail } from '@iace/contracts';
import { Accordion, Alert, StatRow, plural } from '@iace/ui';
import {
  LANGUAGE_CODE_LABELS,
  NAVIGATION_POLICY_LABELS,
  TIMER_TEMPLATE_LABELS,
} from '../lib/constants';
import { durationLabel } from '../lib/duration';

/** The shape a test reads off its base configuration — never the test's to change. */
export function ConfigSummary({ config }: Readonly<{ config: BaseConfigDetail }>) {
  const facts = [
    plural(config.sections.length, 'section'),
    plural(config.totalQuestions, 'question'),
    `${config.totalMarks} marks`,
    durationLabel(config.durationSec),
    TIMER_TEMPLATE_LABELS[config.timerTemplate],
    NAVIGATION_POLICY_LABELS[config.navigation],
    config.languages.map((code) => LANGUAGE_CODE_LABELS[code]).join(', '),
  ].filter((fact) => fact !== '');

  return (
    <Accordion
      className="mb-4"
      title={
        <span className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="font-medium text-foreground">{config.name}</span>
          <span className="text-muted-foreground">{facts.join(' · ')}</span>
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        <Alert variant="info">
          Marks, timing, structure and languages all come from {config.name}. Change the
          configuration and every test built on it changes with it.
        </Alert>

        <div className="grid gap-x-8 gap-y-1 text-xs sm:grid-cols-2">
          {config.sections.map((section) => (
            <StatRow
              key={section.id}
              label={section.name}
              value={`${plural(section.questionCount, 'question')} · ${section.marksPerQuestion} each, −${section.negativeMarks}`}
            />
          ))}
        </div>
      </div>
    </Accordion>
  );
}
