/** The default skin's read-before-you-begin: a stepper, the rules, then the paper. */
import { contentLanguageOf, LANGUAGE_LABELS, type LanguageCode } from '@iace/contracts';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Combobox,
  Field,
  Metric,
  STEPPER_STATES,
  Stepper,
  plural,
} from '@iace/ui';
import { PALETTE_LEGEND } from '../../../lib/constants';
import { DividedList, DividedRow, PageBody, Section, StatBand } from '../../ui';
import { SystemCheck } from '../../system-check';
import { INSTRUCTION_STEPS, type InstructionsView } from './use-instructions';

const RULES: readonly { term: string; says: string }[] = [
  {
    term: 'The clock',
    says: 'Set by the server, and it keeps running if you leave this screen. The paper ends by itself when it reaches zero.',
  },
  { term: 'Save & next', says: 'Keeps your answer and moves on.' },
  {
    term: 'Mark for review & next',
    says: 'Keeps your answer and flags the question. A flagged answer is still marked.',
  },
  { term: 'Clear response', says: 'Removes your answer entirely.' },
  {
    term: 'The palette',
    says: 'Opens any question directly. Moving there does NOT save the question you are on.',
  },
];

const STEP_LABELS: Readonly<Record<(typeof INSTRUCTION_STEPS)[number], string>> = {
  GENERAL: 'Instructions',
  PAPER: 'This paper',
};

export function DefaultInstructions({
  view,
  fullscreenSupported,
}: Readonly<{ view: InstructionsView; fullscreenSupported: boolean }>) {
  return (
    <PageBody className="pb-6">
      <Stepper
        label="Before you begin"
        onValueChange={(value) => view.goTo(value as (typeof INSTRUCTION_STEPS)[number])}
        steps={INSTRUCTION_STEPS.map((step, index) => ({
          value: step,
          label: STEP_LABELS[step],
          state:
            index === view.stepIndex
              ? STEPPER_STATES.CURRENT
              : index < view.stepIndex
                ? STEPPER_STATES.DONE
                : STEPPER_STATES.TODO,
          // A step still ahead is not somewhere a candidate may skip to.
          disabled: index > view.stepIndex,
        }))}
      />

      {view.step === 'GENERAL' ? <GeneralStep /> : null}
      {view.step === 'PAPER' ? (
        <PaperStep view={view} fullscreenSupported={fullscreenSupported} />
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={view.back}>
          Back
        </Button>
        {view.step === 'GENERAL' ? (
          <Button type="button" onClick={view.next}>
            Next
          </Button>
        ) : (
          <Button type="button" disabled={!view.ready} onClick={view.begin}>
            I am ready to begin
          </Button>
        )}
      </div>
    </PageBody>
  );
}

function GeneralStep() {
  return (
    <>
      <Section title="How the paper works">
        <dl className="flex flex-col gap-3 text-sm leading-relaxed">
          {RULES.map((rule) => (
            <div key={rule.term}>
              <dt className="font-medium text-foreground">{rule.term}</dt>
              <dd className="text-muted-foreground">{rule.says}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="Palette">
        <div className="flex flex-wrap gap-2">
          {PALETTE_LEGEND.map((entry) => (
            <Badge key={entry.state} variant={entry.variant}>
              {entry.label}
            </Badge>
          ))}
        </div>
      </Section>

      <SystemCheck />
    </>
  );
}

function PaperStep({
  view,
  fullscreenSupported,
}: Readonly<{ view: InstructionsView; fullscreenSupported: boolean }>) {
  const { brief } = view;

  return (
    <>
      <StatBand>
        <Metric label="Duration (minutes)" value={Math.round(brief.durationSec / 60)} size="sm" />
        <Metric label="Questions" value={brief.totalQuestions} size="sm" />
        <Metric label="Sections" value={brief.sections.length} size="sm" />
      </StatBand>

      <Section title="Sections" meta={plural(brief.sections.length, 'section')}>
        <DividedList>
          {brief.sections.map((section) => (
            <DividedRow
              key={section.id}
              title={section.name}
              meta={`${plural(section.questionCount, 'question')} · +${section.marksPerQuestion}${
                section.negativeMarks > 0 ? ` · −${section.negativeMarks}` : ''
              }`}
            />
          ))}
        </DividedList>
      </Section>

      {view.dual ? (
        <Alert variant="info">
          {`This paper is shown in ${brief.languages.map((code) => LANGUAGE_LABELS[contentLanguageOf(code)]).join(' and ')} together. There is nothing to choose.`}
        </Alert>
      ) : (
        <Field htmlFor="exam-language" label="Language">
          {(control) => (
            <Combobox
              {...control}
              clearable={false}
              placeholder="Choose a language"
              value={view.language}
              onChange={(next) => view.chooseLanguage(next as LanguageCode)}
              items={brief.languages.map((code) => ({
                value: code,
                label: LANGUAGE_LABELS[contentLanguageOf(code)],
              }))}
            />
          )}
        </Field>
      )}

      {fullscreenSupported ? (
        <Alert variant="info">
          The paper opens full screen, and the clock keeps running if you leave it. Your mobile
          number is printed faintly across every question, so a photograph of one leads back to you.
        </Alert>
      ) : null}

      <Checkbox
        checked={view.declared}
        onChange={(event) => view.declare(event.target.checked)}
        label="I have read the instructions and I am ready to begin"
        /* ui-copy-ok: consequence */ hint="The clock starts the moment you begin, and the server keeps it."
      />
    </>
  );
}
