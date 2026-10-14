import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { DIFFICULTY_LEVEL, type QuestionType } from '@iace/contracts';
import { Badge, Button, cn } from '@iace/ui';
import { usePageTour } from '@iace/app-kit/browser';
import { AUTHORING_TOUR, TOUR_IDS, TOUR_TARGETS } from '../../lib/tours';
import { AuthoringHeaderBar } from './authoring-header-bar';
import { Legend, useFocusMode } from './authoring-chrome';
import { carriedHeader, emptyState, toDraft, type AuthoringHeader } from './question-scaffold';
import { useUnsavedPrompt } from './use-unsaved-prompt';
import { useDuplicate, useIssues } from './use-question-checks';
import { CardBody, CardLead } from './workspace-card-body';
import { HeaderTools, SlideOver } from './workspace-chrome';
import {
  SAVE_FIELDS,
  codeErrorOf,
  invalid,
  questionStepOf,
  restingCard,
  restsOn,
  sameHeld,
  scrollToCard,
} from './workspace-helpers';
import {
  BAR,
  FIRST_VIEW,
  NEW_CARD,
  type Held,
  type View,
  type WorkspaceCard,
  type WorkspacePanel,
  type WorkspaceSource,
} from './workspace-types';

const BLANK_HEADER: AuthoringHeader = {
  subjectId: '',
  topicId: '',
  difficulty: DIFFICULTY_LEVEL.MEDIUM,
  tags: '',
};

/** Cards either side of the one in view that keep a live editor; the rest are placeholders. */
const LIVE_AROUND = 1;

/** Every question of a source as one card per screen: one scroll moves to the next, the header follows. */
export function AuthoringWorkspace({
  source,
  startAt,
  onActive,
  onResting,
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
  /** Told the card at rest in the view once it is read, and whether it holds an unsaved edit; null while one is arriving. */
  onResting?: (key: string | null, dirty: boolean) => void;
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
      state: emptyState(lastNew?.type ?? source.types?.[0]),
    }),
    [lastNew, source.create?.header, source.types],
  );

  const [edits, setEdits] = useState<Record<string, Held>>({});
  const [views, setViews] = useState<Record<string, View>>({});
  const [activeKey, setActiveKey] = useState(startAt && keys.includes(startAt) ? startAt : '');
  const [romanised, setRomanised] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [atRest, setAtRest] = useState(true);
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
  const typing = editable && !activeBase.isLoadingError;

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
    setAtRest(restsOn(view, cardRefs.current.get(found)));
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
    meta: { success: 'Question saved.', fields: SAVE_FIELDS },
    mutationFn: ({ key, held }: { key: string; held: Held }) =>
      key === NEW_CARD && source.create ? source.create.save(held) : source.save(key, held),
    onSuccess: (_result, { key, held }) => {
      setEdits(({ [key]: _saved, ...rest }) => rest);
      if (key === NEW_CARD) {
        setLastNew({ header: carriedHeader(held.header), type: held.state.type });
        rebuild(NEW_CARD);
      } else {
        step(1);
      }
    },
  });

  const codeError = codeErrorOf(save.error);
  const draft = useMemo(() => (shown ? toDraft(shown.state, shown.header) : null), [shown]);
  const duplicate = useDuplicate(source.checkDuplicates ? draft : null, isNew ? '' : active);
  const issues = useIssues(draft, shown?.header);
  const dirty = active in edits;
  const unsaved = Object.keys(edits).length;
  useEffect(() => onUnsavedChange?.(unsaved), [unsaved, onUnsavedChange]);
  const resting = restingCard(atRest, shown !== null, active);
  useEffect(() => onResting?.(resting, dirty), [resting, dirty, onResting]);
  useUnsavedPrompt(unsaved > 0);
  // An editable card with nothing changed has nothing to save; moving on is the palette's or the scroll's.
  const canSave =
    !editable || (dirty && issues.length === 0 && duplicate === null && !save.isPending);

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
          types={source.types}
          disabled={!editable}
          codeError={codeError}
          onHeaderChange={(next) => {
            // A refusal of the code is answered by changing it, so it goes the moment anything is typed.
            if (codeError) save.reset();
            edit(active, (current) => ({ ...current, header: next }));
          }}
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
                <div
                  className={cn(
                    'flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-surface shadow-sm',
                    key in edits ? 'border-warning' : 'border-border',
                  )}
                >
                  {Math.abs(index - Math.max(activeIndex, 0)) <= LIVE_AROUND ? (
                    <CardBody
                      questionKey={key}
                      source={source}
                      blank={blank}
                      held={edits[key]}
                      editable={editableCard(key)}
                      lead={lead}
                      actions={card?.actions}
                      status={card?.status}
                      view={views[key] ?? FIRST_VIEW}
                      romanised={romanised}
                      duplicate={key === active ? duplicate : null}
                      onEdit={(change) => edit(key, change)}
                      onView={(change) => view(key, change)}
                      onSave={saveAndNext}
                    />
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
