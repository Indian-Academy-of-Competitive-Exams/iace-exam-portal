import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { Keyboard, ListChecks, Maximize2, Minimize2, Save, X } from 'lucide-react';
import {
  DEFAULT_LANGUAGE,
  DIFFICULTY_LEVEL,
  LANGUAGE_LABELS,
  LANGUAGE_ORDER,
  type QuestionLanguage,
  type QuestionType,
} from '@iace/contracts';
import { Badge, Button, Skeleton, Tooltip, TooltipContent, TooltipTrigger, cn } from '@iace/ui';
import { type ScaffoldRegion } from '@iace/ui/scaffold-editor';
import { usePageTour } from '@iace/app-kit/browser';
import { AUTHORING_TOUR, TOUR_IDS, TOUR_TARGETS } from '../../lib/tours';
import { AuthoringHeaderBar } from './authoring-header-bar';
import { Legend, QuestionNotLoaded, useFocusMode } from './authoring-chrome';
import { QuestionPanes } from './question-panes';
import {
  SCRIPT_OF,
  emptyState,
  stateFrom,
  toDraft,
  type AuthoringHeader,
  type AuthoringState,
} from './question-scaffold';
import { useUnsavedPrompt } from './use-unsaved-prompt';
import { issuesOf, useChecked, useDuplicate, useIssues } from './use-question-checks';

/** What the box says. Held as an edit only while it differs from the saved one: that is what "unsaved" means. */
export interface Held {
  header: AuthoringHeader;
  state: AuthoringState;
  /** Whatever a save must still match on the server, carried untouched through every edit. */
  stamp?: string;
}

/** One question's card: where it stands, what may be done to it, and whether it can be typed into. */
export interface WorkspaceCard {
  key: string;
  lead: React.ReactNode;
  actions?: React.ReactNode;
  notice?: React.ReactNode;
  editable: boolean;
}

/** Where the cards come from, and where a saved one goes. */
export interface WorkspaceSource {
  cards: readonly WorkspaceCard[];
  query: (key: string) => { queryKey: QueryKey; queryFn: () => Promise<Held> };
  save: (key: string, held: Held) => Promise<unknown>;
  subjectLocked: boolean;
  /** Only where a copy of a bank question refuses the save; an import row just becomes a duplicate. */
  checkDuplicates: boolean;
  /** A blank card after the last, for writing the next question; absent where nothing new is written. */
  create?: {
    header: AuthoringHeader;
    save: (held: Held) => Promise<unknown>;
    /** After the blank card's own name, in its bar. */
    lead?: React.ReactNode;
  };
  /** Somebody else holds every card: none of them takes an edit until they hand it on. */
  blocked?: boolean;
}

interface PanelPosition {
  activeKey: string;
  jump: (key: string) => void;
}

/** The progress panel: the trigger opens it over the cards, and it can move them. */
export interface WorkspacePanel {
  label: string;
  render: (position: PanelPosition) => React.ReactNode;
}

/** The key of the blank card a new question is typed into. */
export const NEW_CARD = 'new';

interface View {
  language: QuestionLanguage;
  /** Bumped when the box must be rebuilt: a language, a type, or an option count changed. */
  box: number;
}

const FIRST_VIEW: View = { language: DEFAULT_LANGUAGE, box: 0 };

const BLANK_HEADER: AuthoringHeader = {
  subjectId: '',
  topicId: '',
  difficulty: DIFFICULTY_LEVEL.MEDIUM,
  tags: '',
};

const sameHeld = (a: Held, b: Held): boolean => JSON.stringify(a) === JSON.stringify(b);

const invalid = (held: Held): boolean =>
  issuesOf(toDraft(held.state, held.header), held.header).length > 0;

/** Cards either side of the one in view that keep a live editor; the rest are placeholders. */
const LIVE_AROUND = 1;

/** With Alt held, the arrow that moves to the previous or the next question. */
const QUESTION_STEP_KEYS: Readonly<Record<string, number>> = { ArrowUp: -1, ArrowDown: 1 };

const BAR =
  'flex min-h-10 flex-none items-center justify-between gap-3 border-b border-border px-4';

/** Every question of a source as one card per screen: one scroll moves to the next, the header follows. */
export function AuthoringWorkspace({
  source,
  startAt,
  onActive,
  title,
  saveLabel,
  extraActions,
  onUnsavedChange,
  panel,
}: Readonly<{
  source: WorkspaceSource;
  startAt: string | null;
  /** Told the card in view, so the page's URL can follow it. */
  onActive?: (key: string) => void;
  /** What every card belongs to, named in its language bar ahead of the question. */
  title?: React.ReactNode;
  saveLabel: string;
  /** Beside Save in the bottom bar. */
  extraActions?: React.ReactNode;
  /** Told how many cards hold edits, so the page can ask before a move leaves them behind. */
  onUnsavedChange?: (cards: number) => void;
  panel?: WorkspacePanel;
}>) {
  const queryClient = useQueryClient();
  const focus = useFocusMode();
  const keys = useMemo(
    () => [...source.cards.map((card) => card.key), ...(source.create ? [NEW_CARD] : [])],
    [source],
  );
  // The next question is the same subject, level and type: a save keeps what it was typed under.
  const [lastNew, setLastNew] = useState<{ header: AuthoringHeader; type: QuestionType } | null>(
    null,
  );
  const blank = useMemo(
    (): Held => ({
      header: lastNew?.header ?? source.create?.header ?? BLANK_HEADER,
      state: emptyState(lastNew?.type),
    }),
    [lastNew, source.create?.header],
  );

  const [edits, setEdits] = useState<Record<string, Held>>({});
  const [views, setViews] = useState<Record<string, View>>({});
  const [activeKey, setActiveKey] = useState(startAt && keys.includes(startAt) ? startAt : '');
  const [romanised, setRomanised] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());

  const active = activeKey || keys[0] || '';
  const activeIndex = keys.indexOf(active);
  const isNew = active === NEW_CARD;
  const language = (views[active] ?? FIRST_VIEW).language;

  const activeBase = useQuery({
    ...source.query(active),
    enabled: active !== '' && !isNew,
  });
  const base = isNew ? blank : (activeBase.data ?? null);
  const shown = edits[active] ?? base;
  const editableCard = (key: string) =>
    !source.blocked &&
    (key === NEW_CARD || Boolean(source.cards.find((card) => card.key === key)?.editable));
  const editable = editableCard(active);
  // A card that was not read has nothing to save; with others beside it the button still moves on.
  const typing = editable && !(activeBase.isError && !activeBase.data);

  const held = useRef(active);
  useEffect(() => {
    held.current = active;
  }, [active]);

  // Cards are the scroller's height, so any resize moves them all: hold the card in view, the opened one first.
  useEffect(() => {
    const view = scroller.current;
    if (!view) return;
    const stay = new ResizeObserver(() =>
      cardRefs.current.get(held.current)?.scrollIntoView({ block: 'start' }),
    );
    stay.observe(view);
    return () => stay.disconnect();
  }, []);

  useEffect(() => {
    if (active) onActive?.(active);
  }, [active, onActive]);

  const findActive = useCallback(() => {
    const view = scroller.current;
    if (!view) return;
    const line = view.scrollTop + view.clientHeight / 2;
    let found = keys[0] ?? '';
    for (const key of keys) {
      const card = cardRefs.current.get(key);
      if (card && card.offsetTop <= line) found = key;
    }
    if (found !== activeKey) setActiveKey(found);
  }, [keys, activeKey]);

  // A deleted question's card is gone: whichever card slid into its place is the one in view.
  useEffect(() => {
    if (activeKey && !keys.includes(activeKey)) findActive();
  }, [keys, activeKey, findActive]);

  const jump = useCallback((key: string) => scrollToCard(cardRefs.current.get(key)), []);
  const step = useCallback(
    (by: number) => {
      const target = keys[activeIndex + by];
      if (target) jump(target);
    },
    [keys, activeIndex, jump],
  );

  useEffect(() => {
    const move = (event: KeyboardEvent) => {
      const by = questionStepOf(event);
      if (by === null) return;
      // Captured before the editor, whose own arrows move between the parts of one question.
      event.preventDefault();
      event.stopPropagation();
      step(by);
    };
    window.addEventListener('keydown', move, true);
    return () => window.removeEventListener('keydown', move, true);
  }, [step]);

  const edit = useCallback(
    (key: string, change: (current: Held) => Held) => {
      setEdits((all) => {
        const saved =
          key === NEW_CARD ? blank : queryClient.getQueryData<Held>(source.query(key).queryKey);
        if (!saved) return all;
        const next = change(all[key] ?? saved);
        // Back to what is saved, whether typed back or normalised by the editor: nothing is pending.
        if (sameHeld(next, saved)) {
          const { [key]: _same, ...rest } = all;
          return rest;
        }
        return { ...all, [key]: next };
      });
    },
    [queryClient, source, blank],
  );
  const view = useCallback((key: string, change: (current: View) => View) => {
    setViews((all) => ({ ...all, [key]: change(all[key] ?? FIRST_VIEW) }));
  }, []);
  const rebuild = (key: string) => view(key, (current) => ({ ...current, box: current.box + 1 }));

  const save = useMutation({
    meta: { success: 'Question saved.' },
    mutationFn: ({ key, held }: { key: string; held: Held }) =>
      key === NEW_CARD && source.create ? source.create.save(held) : source.save(key, held),
    onSuccess: (_result, { key, held }) => {
      setEdits(({ [key]: _saved, ...rest }) => rest);
      if (key === NEW_CARD) {
        setLastNew({ header: held.header, type: held.state.type });
        rebuild(NEW_CARD);
      } else {
        step(1);
      }
    },
  });

  const draft = useMemo(() => (shown ? toDraft(shown.state, shown.header) : null), [shown]);
  const duplicate = useDuplicate(source.checkDuplicates ? draft : null, isNew ? '' : active);
  const issues = useIssues(draft, shown?.header);
  const dirty = active in edits;
  const unsaved = Object.keys(edits).length;
  useEffect(() => onUnsavedChange?.(unsaved), [unsaved, onUnsavedChange]);
  useUnsavedPrompt(unsaved > 0);
  const canSave =
    !editable || !dirty || (issues.length === 0 && duplicate === null && !save.isPending);

  const saveAndNext = () => {
    const held = edits[active];
    if (!held || !editable) return step(1);
    // The button reads issues that lag the last keystroke, so the save judges what it is about to send.
    if (save.isPending || invalid(held)) return;
    save.mutate({ key: active, held });
  };

  const tools = (
    <HeaderTools
      language={language}
      romanised={romanised}
      editable={editable}
      immersive={focus.immersive}
      panelLabel={panel?.label ?? null}
      panelOpen={panelOpen}
      onRomanised={() => setRomanised((on) => !on)}
      onPanel={() => setPanelOpen((open) => !open)}
      onFocus={focus.toggle}
    />
  );

  usePageTour({ id: TOUR_IDS.AUTHORING, steps: AUTHORING_TOUR, ready: shown !== null });

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {shown ? (
        <AuthoringHeaderBar
          header={shown.header}
          state={shown.state}
          subjectLocked={source.subjectLocked}
          disabled={!editable}
          onHeaderChange={(next) => edit(active, (current) => ({ ...current, header: next }))}
          onStateChange={(next) => {
            edit(active, (current) => ({ ...current, state: next }));
            rebuild(active);
          }}
          lead={dirty ? <Badge variant="warning">Unsaved</Badge> : undefined}
          actions={tools}
        />
      ) : (
        <div className="flex flex-none items-center justify-end gap-x-4 border-b border-border bg-surface px-4 py-2">
          {tools}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        <div
          ref={scroller}
          onScroll={findActive}
          data-tour={TOUR_TARGETS.AUTHORING_CARD}
          className="relative min-h-0 flex-1 snap-y snap-mandatory overflow-y-auto bg-muted/40"
        >
          {keys.map((key, index) => {
            const card = source.cards.find((one) => one.key === key);
            const lead = (
              <CardLead title={title}>{leadOf(key, card, source.create?.lead)}</CardLead>
            );
            return (
              <section
                key={key}
                data-card={key}
                ref={(node) => {
                  if (node) cardRefs.current.set(key, node);
                  else cardRefs.current.delete(key);
                }}
                aria-label={key === NEW_CARD ? 'New question' : `Question ${index + 1}`}
                className="flex h-full snap-start p-4"
              >
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
                  {Math.abs(index - Math.max(activeIndex, 0)) <= LIVE_AROUND ? (
                    <>
                      {card?.notice}
                      <CardBody
                        questionKey={key}
                        source={source}
                        blank={blank}
                        held={edits[key]}
                        editable={editableCard(key)}
                        lead={lead}
                        actions={card?.actions}
                        view={views[key] ?? FIRST_VIEW}
                        romanised={romanised}
                        duplicate={key === active ? duplicate : null}
                        onEdit={(change) => edit(key, change)}
                        onView={(change) => view(key, change)}
                        onSave={saveAndNext}
                      />
                    </>
                  ) : (
                    <div className={BAR}>{lead}</div>
                  )}
                </div>
              </section>
            );
          })}
        </div>

        {panel ? (
          <SlideOver
            panel={panel}
            open={panelOpen}
            onClose={() => setPanelOpen(false)}
            activeKey={active}
            jump={jump}
          />
        ) : null}
      </div>

      <Legend
        questions
        actions={
          <>
            {extraActions}
            {typing || keys.length > 1 ? (
              <Button
                type="button"
                size="sm"
                disabled={!canSave}
                loading={save.isPending}
                onClick={saveAndNext}
              >
                <Save aria-hidden />
                {typing ? saveLabel : 'Next'}
              </Button>
            ) : null}
          </>
        }
      />
    </div>
  );
}

/** Whose question this is and which one, at the start of the card's language bar. */
function CardLead({
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

/** Alt with an arrow, anywhere but inside a dialog, is a move to the previous or next question. */
function questionStepOf(event: KeyboardEvent): number | null {
  const by = QUESTION_STEP_KEYS[event.key];
  if (!event.altKey || by === undefined) return null;
  const inDialog = event.target instanceof Element && event.target.closest('[role="dialog"]');
  return inDialog ? null : by;
}

function scrollToCard(card: HTMLElement | undefined) {
  if (!card) return;
  card.scrollIntoView({ block: 'start', behavior: 'smooth' });
  const typing = document.activeElement?.closest('[data-card]');
  if (!typing || typing === card) return;
  // Typing follows the card in view, never the one scrolled away.
  const box = card.querySelector<HTMLElement>('[contenteditable="true"]');
  if (box) box.focus({ preventScroll: true });
  else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

function leadOf(
  key: string,
  card: WorkspaceCard | undefined,
  blankLead: React.ReactNode,
): React.ReactNode {
  if (key !== NEW_CARD) return card?.lead;
  return (
    <>
      <span className="text-sm font-semibold">New question</span>
      {blankLead}
    </>
  );
}

/** The progress panel over the cards' right edge, like the app shell's menu: nothing moves under it. */
function SlideOver({
  panel,
  open,
  onClose,
  ...position
}: Readonly<PanelPosition & { panel: WorkspacePanel; open: boolean; onClose: () => void }>) {
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open, onClose]);

  return (
    <aside
      aria-label={panel.label}
      aria-hidden={!open}
      className={cn(
        'absolute inset-y-0 right-0 z-20 flex w-80 max-w-full flex-col border-l border-border bg-surface shadow-lg transition-transform duration-200',
        open ? 'translate-x-0' : 'pointer-events-none translate-x-full',
      )}
    >
      <div className="flex flex-none items-center justify-between border-b border-border px-4 py-2">
        <h2 className="text-sm font-semibold">{panel.label}</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Close ${panel.label}`}
          onClick={onClose}
        >
          <X aria-hidden />
        </Button>
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto p-4">
        <PanelBody panel={panel} {...position} />
      </div>
    </aside>
  );
}

function PanelBody({ panel, ...position }: Readonly<PanelPosition & { panel: WorkspacePanel }>) {
  return panel.render(position);
}

function CardBody({
  questionKey,
  source,
  blank,
  held,
  editable,
  lead,
  actions,
  view,
  romanised,
  duplicate,
  onEdit,
  onView,
  onSave,
}: Readonly<{
  questionKey: string;
  source: WorkspaceSource;
  blank: Held;
  held: Held | undefined;
  editable: boolean;
  lead: React.ReactNode;
  actions: React.ReactNode;
  view: View;
  romanised: boolean;
  duplicate: string | null;
  onEdit: (change: (current: Held) => Held) => void;
  onView: (change: (current: View) => View) => void;
  onSave: () => void;
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
      view={view}
      romanised={romanised}
      duplicate={duplicate}
      onEdit={onEdit}
      onView={onView}
      onSave={onSave}
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
  view,
  romanised,
  duplicate,
  onEdit,
  onView,
  onSave,
}: Readonly<{
  questionKey: string;
  shown: Held;
  readOnly: boolean;
  lead: React.ReactNode;
  actions: React.ReactNode;
  view: View;
  romanised: boolean;
  duplicate: string | null;
  onEdit: (change: (current: Held) => Held) => void;
  onView: (change: (current: View) => View) => void;
  onSave: () => void;
}>) {
  const draft = useMemo(() => toDraft(shown.state, shown.header), [shown]);
  const { checks } = useChecked(draft, shown.header, shown.state, duplicate);
  const switchTo = (language: QuestionLanguage) =>
    onView((current) => ({ language, box: current.box + 1 }));

  return (
    <QuestionPanes
      lead={lead}
      previewAction={actions}
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

/** The header's right end: how letters are typed, progress, full screen. */
function HeaderTools({
  language,
  romanised,
  editable,
  immersive,
  panelLabel,
  panelOpen,
  onRomanised,
  onPanel,
  onFocus,
}: Readonly<{
  language: QuestionLanguage;
  romanised: boolean;
  editable: boolean;
  immersive: boolean;
  panelLabel: string | null;
  panelOpen: boolean;
  onRomanised: () => void;
  onPanel: () => void;
  onFocus: () => void;
}>) {
  return (
    <div className="flex flex-none items-center gap-2">
      {editable && SCRIPT_OF[language] ? (
        <IconAction
          label={
            romanised
              ? `Typing dhanyavaad writes it in ${LANGUAGE_LABELS[language]}`
              : 'Roman letters stay as they are typed'
          }
          pressed={romanised}
          onClick={onRomanised}
        >
          <Keyboard aria-hidden />
        </IconAction>
      ) : null}
      {panelLabel ? (
        <span data-tour={TOUR_TARGETS.AUTHORING_PROGRESS}>
          <IconAction label={panelLabel} pressed={panelOpen} onClick={onPanel}>
            <ListChecks aria-hidden />
          </IconAction>
        </span>
      ) : null}
      <IconAction label={immersive ? 'Leave full screen' : 'Full screen'} onClick={onFocus}>
        {immersive ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
      </IconAction>
    </div>
  );
}

function IconAction({
  label,
  pressed,
  onClick,
  children,
}: Readonly<{
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={pressed ? 'default' : 'ghost'}
          size="icon"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
