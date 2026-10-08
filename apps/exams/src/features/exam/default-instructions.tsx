/** The default skin's read-before-you-begin: the rules, then the paper, over two screens. */
import {
  contentLanguageOf,
  EXAM_TEMPLATE,
  LANGUAGE_LABELS,
  type LanguageCode,
} from '@iace/contracts';
import {
  Alert,
  Button,
  Checkbox,
  Combobox,
  Field,
  Metric,
  PAGE_CONTENT_CLASS,
  PageFrame,
  PageHeader,
  cn,
  plural,
} from '@iace/ui';
import {
  DividedList,
  DividedRow,
  PageBody,
  Section,
  StatBand,
  SurfaceCard,
} from '../../components/ui';
import { PaletteLegend } from './question-palette';
import { SystemCheck } from './system-check';
import { type InstructionsView } from './use-instructions';

/** What the shell calls `narrow`: a page to read, not a grid to scan. */
const NARROW = 'max-w-5xl';

const CLOCK = {
  term: 'The clock',
  says: 'Set by the server, and it keeps running if you leave this screen. The paper ends by itself when it reaches zero.',
};
const CLEAR = { term: 'Clear response', says: 'Removes your answer entirely.' };
const SUBMIT = {
  term: 'Submit',
  says: 'Hands the paper in for good. It asks you to confirm first, and shows what you are leaving unanswered.',
};
const SECTIONAL = {
  term: 'Sectional timing',
  says: 'Each section has a clock of its own, and a section whose time ends locks — its questions cannot be opened again.',
};

const NEXT = { term: 'Next', says: 'Moves on and leaves the question as it stands.' };
const FREE_PALETTE = {
  term: 'The palette',
  says: 'Opens any question directly. The question you leave keeps its answer.',
};
const FORWARD_PALETTE = {
  term: 'The palette',
  says: 'Shows where you are. A question you have left cannot be opened again, and there is no marking one for review.',
};

type Rule = { term: string; says: string };

const FREE_RULES: readonly Rule[] = [
  { term: 'Save & next', says: 'Keeps your answer and moves on.' },
  {
    term: 'Mark for review & next',
    says: 'Keeps your answer and flags the question. A flagged answer is still marked.',
  },
  CLEAR,
  FREE_PALETTE,
  SUBMIT,
];

const FORWARD_RULES: readonly Rule[] = [
  { term: 'Save & next', says: 'Keeps your answer and moves on. It is the only way forward.' },
  CLEAR,
  FORWARD_PALETTE,
  SUBMIT,
];

/** A bubble sheet has no Save, Mark or Clear to teach: the ink carries all three. */
const OMR_FREE_RULES: readonly Rule[] = [
  {
    term: 'The bubble',
    says: 'Hold a bubble to fill it. A full bubble is your answer for good and moves you on. A part-filled one keeps the answer and flags the question for review, and can still be changed.',
  },
  NEXT,
  FREE_PALETTE,
  SUBMIT,
];

const OMR_FORWARD_RULES: readonly Rule[] = [
  {
    term: 'The bubble',
    says: 'Hold a bubble to fill it. Once the ink takes that is your answer for good, and a full bubble moves you on.',
  },
  NEXT,
  FORWARD_PALETTE,
  SUBMIT,
];

interface PaperTraits {
  forwardOnly: boolean;
  sectional: boolean;
  omr: boolean;
}

function rulesFor({ forwardOnly, sectional, omr }: PaperTraits): readonly Rule[] {
  const cbt = forwardOnly ? FORWARD_RULES : FREE_RULES;
  const bubbled = forwardOnly ? OMR_FORWARD_RULES : OMR_FREE_RULES;
  return [CLOCK, ...(sectional ? [SECTIONAL] : []), ...(omr ? bubbled : cbt)];
}

/** One list, read before the paper opens and again from inside it, so the two cannot disagree. */
export function PaperRules(traits: Readonly<PaperTraits>) {
  return (
    <dl className="flex flex-col gap-3 text-sm leading-relaxed">
      {rulesFor(traits).map((rule) => (
        <div key={rule.term}>
          <dt className="font-medium text-foreground">{rule.term}</dt>
          <dd className="text-muted-foreground">{rule.says}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DefaultInstructions({
  view,
  fullscreenSupported,
}: Readonly<{ view: InstructionsView; fullscreenSupported: boolean }>) {
  const { brief } = view;

  return (
    <div className={cn('flex h-dvh flex-col', PAGE_CONTENT_CLASS, NARROW)}>
      <PageFrame
        header={
          <PageHeader
            size="display"
            title={brief.title ?? 'Instructions'}
            meta={`${plural(brief.totalQuestions, 'question')} · ${plural(Math.round(brief.durationSec / 60), 'minute')}`}
          />
        }
        footer={<Walk view={view} />}
      >
        <PageBody className="pb-6">
          {view.step === 'GENERAL' ? (
            <GeneralStep forwardOnly={view.forwardOnly} sectional={view.sectional} omr={view.omr} />
          ) : (
            <PaperStep view={view} fullscreenSupported={fullscreenSupported} />
          )}
        </PageBody>
      </PageFrame>
    </div>
  );
}

/** Back and on, held under the body the way the paper itself holds its own controls. */
function Walk({ view }: Readonly<{ view: InstructionsView }>) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
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
  );
}

function GeneralStep({ forwardOnly, sectional, omr }: Readonly<PaperTraits>) {
  return (
    <>
      {forwardOnly ? (
        <Alert variant="warning">
          This paper runs one way. Once you leave a question you cannot return to it, so answer
          before you move on.
        </Alert>
      ) : null}

      <SurfaceCard title="How the paper works">
        <PaperRules forwardOnly={forwardOnly} sectional={sectional} omr={omr} />
      </SurfaceCard>

      <SurfaceCard title="Palette">
        {/* Outside the sitting's shell, so the card names the skin itself or its swatches have no colour. */}
        <div data-exam-template={EXAM_TEMPLATE.DEFAULT.toLowerCase()}>
          <PaletteLegend forwardOnly={forwardOnly} />
        </div>
      </SurfaceCard>

      <SurfaceCard title="System check">
        <SystemCheck />
      </SurfaceCard>
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

      <SurfaceCard>
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
            number is printed faintly across every question, so a photograph of one leads back to
            you.
          </Alert>
        ) : null}

        <Checkbox
          checked={view.declared}
          onChange={(event) => view.declare(event.target.checked)}
          label="I have read the instructions and I am ready to begin"
          /* ui-copy-ok: consequence */ hint="The clock starts the moment you begin, and the server keeps it."
        />
      </SurfaceCard>
    </>
  );
}
