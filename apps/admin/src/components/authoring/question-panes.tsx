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
  flow = false,
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
  /** In a window that scrolls as a whole, each pane grows with its question instead. */
  flow?: boolean;
}>) {
  const scrolls = flow ? '' : 'min-h-0 flex-1 overflow-y-auto';
  const script = romanised ? (SCRIPT_OF[language] ?? null) : null;

  return (
    <div
      className={cn(
        'grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]',
        !flow && 'min-h-0 flex-1',
      )}
    >
      <section className="flex min-h-0 flex-col border-border lg:border-r">
        <PanelHeading
          action={
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
          }
        />
        <div className={cn('flex flex-col', scrolls)}>
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
            className="flex-1 rounded-none border-0 shadow-none"
          />
        </div>
      </section>

      <section className="flex min-h-0 flex-col">
        <PanelHeading title="Preview and validation" />
        <div className={cn('flex flex-col gap-4 p-4', scrolls)}>
          <AuthoringPreview state={state} language={language} />
          <AuthoringChecks checks={checks} />
        </div>
      </section>
    </div>
  );
}

/** A pane whose content names itself takes no title; the bar stays so both panes line up. */
function PanelHeading({ title, action }: Readonly<{ title?: string; action?: React.ReactNode }>) {
  return (
    <div className="flex h-10 flex-none items-center justify-between gap-3 border-b border-border bg-surface px-4">
      {title ? <h2 className="text-sm font-semibold">{title}</h2> : <span />}
      {action}
    </div>
  );
}
