import {
  LANGUAGE_LABELS,
  LANGUAGE_ORDER,
  QUESTION_IMAGE_ACCEPTED_TYPES,
  QUESTION_IMAGE_MAX_BYTES,
  type QuestionLanguage,
} from '@iace/contracts';
import { SegmentedControl, cn } from '@iace/ui';
import { ScaffoldEditor, type ScaffoldRegion } from '@iace/ui/scaffold-editor';
import { uploadQuestionImage } from '../../lib/upload-question-image';
import { AuthoringChecks, AuthoringPreview, type Check } from './authoring-preview';
import { SCRIPT_OF, regionsFor, type AuthoringState } from './question-scaffold';

const IMAGE_LIMITS = {
  maxBytes: QUESTION_IMAGE_MAX_BYTES,
  accept: QUESTION_IMAGE_ACCEPTED_TYPES,
};

/** Each pane scrolls on its own, so a long question never pushes the other out of view. */
const SCROLLS = 'relative flex min-h-0 flex-1 flex-col overflow-y-auto';

/** The two columns the typist works in: what they are writing, and what it looks like. */
export function QuestionPanes({
  questionId,
  state,
  language,
  romanised,
  canSave,
  boxVersion,
  checks,
  onRegions,
  onCycleLanguage,
  onLanguageChange,
  onSave,
  lead,
  previewAction,
  blocked = false,
}: Readonly<{
  questionId: string;
  state: AuthoringState;
  language: QuestionLanguage;
  romanised: boolean;
  canSave: boolean;
  boxVersion: number;
  checks: readonly Check[];
  onRegions: (regions: ScaffoldRegion[]) => void;
  onCycleLanguage: () => void;
  onLanguageChange: (next: QuestionLanguage) => void;
  onSave: () => void;
  /** Ahead of the languages: whose question this is, where there are several. */
  lead?: React.ReactNode;
  /** At the preview's end: what may be done to this question. */
  previewAction?: React.ReactNode;
  /** Somebody else holds the question: the editor shows, and takes nothing. */
  blocked?: boolean;
}>) {
  const script = romanised ? (SCRIPT_OF[language] ?? null) : null;
  const languages = (
    <SegmentedControl
      value={language}
      onChange={(value) => onLanguageChange(value as QuestionLanguage)}
      aria-label="Language"
      items={LANGUAGE_ORDER.map((code) => ({
        value: code,
        label: code.toUpperCase(),
        name: LANGUAGE_LABELS[code],
      }))}
    />
  );

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="flex min-h-0 flex-col border-border lg:border-r">
        {/* Which language is read is navigation, so it leaves the editor that is frozen under it. */}
        {lead || blocked ? (
          <PanelHeading lead={lead} action={blocked ? languages : undefined} />
        ) : null}
        <div inert={blocked} className={cn(SCROLLS, blocked && 'opacity-60')}>
          <ScaffoldEditor
            aria-label="Question"
            regions={regionsFor(state, language)}
            docKey={`${questionId || 'new'}:${language}:${state.type}:${boxVersion}`}
            onChange={onRegions}
            onSave={() => {
              if (canSave) onSave();
            }}
            onCycleLanguage={onCycleLanguage}
            onUploadImage={uploadQuestionImage}
            imageLimits={IMAGE_LIMITS}
            lang={language}
            script={script}
            toolbarEnd={blocked ? undefined : languages}
            // The card is the frame: the box it fills draws no ring or border of its own.
            className="flex-1 rounded-none border-0 shadow-none focus-within:border-transparent focus-within:shadow-none"
          />
        </div>
      </section>

      <section className="flex min-h-0 flex-col">
        <PanelHeading
          lead={<h2 className="text-sm font-semibold">Preview and validation</h2>}
          action={previewAction}
        />
        <div className={cn(SCROLLS, 'gap-4 p-4')}>
          <AuthoringPreview state={state} language={language} />
          <AuthoringChecks checks={checks} />
        </div>
      </section>
    </div>
  );
}

/** What a pane shows, and what may be done to it, in one bar above it. */
function PanelHeading({
  lead,
  action,
}: Readonly<{ lead?: React.ReactNode; action?: React.ReactNode }>) {
  return (
    <div className="flex min-h-10 flex-none items-center justify-between gap-3 border-b border-border bg-surface px-4">
      {lead ?? <span />}
      {action ? <div className="flex flex-none items-center gap-2">{action}</div> : null}
    </div>
  );
}
