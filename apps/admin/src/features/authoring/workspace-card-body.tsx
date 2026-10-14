import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LANGUAGE_ORDER, type LanguageCode, type QuestionLanguage } from '@iace/contracts';
import { Skeleton } from '@iace/ui';
import { type ScaffoldRegion } from '@iace/ui/scaffold-editor';
import { QuestionNotLoaded } from './authoring-chrome';
import { QuestionPanes } from './question-panes';
import { stateFrom, toDraft } from './question-scaffold';
import { useChecked } from './use-question-checks';
import { BAR, NEW_CARD, type Held, type View, type WorkspaceSource } from './workspace-types';

/** Whose question this is and which one, at the start of the card's language bar. */
export function CardLead({
  title,
  children,
}: Readonly<{ title: React.ReactNode; children: React.ReactNode }>) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      {title}
      <span className="flex flex-none items-center gap-2">{children}</span>
    </span>
  );
}

type CardChromeProps = Readonly<{
  lead: React.ReactNode;
  actions: React.ReactNode;
  status?: React.ReactNode;
  view: View;
  romanised: boolean;
  duplicate: string | null;
  onEdit: (change: (current: Held) => Held) => void;
  onView: (change: (current: View) => View) => void;
  onSave: () => void;
}>;

export function CardBody({
  questionKey,
  source,
  blank,
  held,
  editable,
  lead,
  actions,
  status,
  view,
  romanised,
  duplicate,
  onEdit,
  onView,
  onSave,
}: CardChromeProps &
  Readonly<{
    questionKey: string;
    source: WorkspaceSource;
    blank: Held;
    held: Held | undefined;
    editable: boolean;
  }>) {
  const isNew = questionKey === NEW_CARD;
  const base = useQuery({ ...source.query(questionKey), enabled: !isNew });
  const saved = isNew ? blank : base.data;

  if (!saved) {
    return (
      <>
        <div className={BAR}>{lead}</div>
        {base.isError ? (
          <QuestionNotLoaded error={base.error} onRetry={() => void base.refetch()} />
        ) : (
          <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        )}
      </>
    );
  }
  return (
    <EditBody
      questionKey={isNew ? '' : questionKey}
      shown={held ?? saved}
      readOnly={!editable}
      lead={lead}
      actions={actions}
      status={status}
      view={view}
      romanised={romanised}
      duplicate={duplicate}
      onEdit={onEdit}
      onView={onView}
      onSave={onSave}
      languages={source.languages}
    />
  );
}

/** One question in its two panes; read-only, the same two with the editor frozen. */
function EditBody({
  questionKey,
  shown,
  readOnly,
  lead,
  actions,
  status,
  view,
  romanised,
  duplicate,
  onEdit,
  onView,
  onSave,
  languages,
}: CardChromeProps &
  Readonly<{
    questionKey: string;
    shown: Held;
    readOnly: boolean;
    languages?: readonly LanguageCode[];
  }>) {
  const draft = useMemo(() => toDraft(shown.state, shown.header), [shown]);
  const { checks } = useChecked(draft, shown.header, shown.state, duplicate, languages);
  const switchTo = (language: QuestionLanguage) =>
    onView((current) => ({ language, box: current.box + 1 }));

  return (
    <QuestionPanes
      lead={lead}
      previewAction={actions}
      status={status}
      questionId={questionKey}
      state={shown.state}
      language={view.language}
      romanised={romanised}
      canSave={!readOnly}
      readOnly={readOnly}
      boxVersion={view.box}
      checks={checks}
      onRegions={(regions: ScaffoldRegion[]) =>
        onEdit((current) => ({
          ...current,
          state: stateFrom(current.state, view.language, regions),
        }))
      }
      onCycleLanguage={() => {
        const at = LANGUAGE_ORDER.indexOf(view.language);
        switchTo(LANGUAGE_ORDER[(at + 1) % LANGUAGE_ORDER.length] ?? view.language);
      }}
      onLanguageChange={switchTo}
      onSave={onSave}
    />
  );
}
