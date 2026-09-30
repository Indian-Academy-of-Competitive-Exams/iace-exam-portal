import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SlidersHorizontal } from 'lucide-react';
import {
  ASSIGNMENT_ROLES,
  AppException,
  FEATURE_KEYS,
  FORM_LEVEL_FIELD,
  PAPER_SOURCES,
  PERMISSION_LEVELS,
  sectionQuota,
  scopedSections,
  type Assignment,
  type BaseConfigSection,
  type DrawSpec,
  type PaperSource,
  type SectionDrawSpec,
  type TestDetail,
  type TestPaper,
} from '@iace/contracts';
import { PageCrumbs, useFilters } from '@iace/app-kit/browser';
import {
  EmptyState,
  linkVariants,
  EMPTY_STATE_KINDS,
  Alert,
  Badge,
  Button,
  CAPPED_VIEWPORT,
  ConfirmDialog,
  PageHeader,
  PanelFrame,
  Skeleton,
  SkeletonParagraph,
  Separator,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
  plural,
  type BreadcrumbItem,
} from '@iace/ui';
import { api } from '../lib/api';
import { durationLabel } from '../lib/duration';
import { useAuth } from '../providers/auth';
import { DrawSpecEditor } from '../components/draw-spec';
import { PaperQuestions } from '../components/paper-questions';
import { QuestionChooser, type QuestionPicks } from '../components/question-picker';
import { FULLNESS_VARIANT, holderOf, sectionFullness, sectionTally } from './test-paper-view';
import {
  NAV_ITEMS,
  QUERY_KEYS,
  ROUTES,
  testAssignmentsQueryKey,
  testPaperQueryKey,
  testQueryKey,
} from '../lib/constants';

/** One test's paper on a whole screen: the sections down the side, the work beside them. */

/** Referentially stable, so a test that has never had a pool does not remount the editor. */
const NO_SPEC: DrawSpec = { sections: {} };
const NO_PICKS: QuestionPicks = new Map();

/** A batch is refused whole, under whichever of these keys the server reached for. */
const ADD_ERROR_FIELDS = ['questionId', 'questionIds', FORM_LEVEL_FIELD] as const;

/** The Offer step's own words, so both screens say one thing about a paper that has gone out. */
const PAPER_IS_FROZEN =
  'This test has been offered, so its paper is frozen. A question on it can still be dropped or made a bonus.';

/** The rebuild is a delayed, deduped job — no screen can say it is done, so none of them claims it. */
const RE_SCORING_RUNS =
  'Every sitting that served a question you changed is being scored again, and the standings rebuilt after them. Scores, ranks and percentiles settle when that finishes.';

export function TestPaperPage() {
  const { id } = useParams();
  const testId = id ?? '';

  const test = useQuery({
    queryKey: testQueryKey(testId),
    queryFn: () => api.admin.tests.detail(testId),
    enabled: testId !== '',
  });

  const paper = useQuery({
    queryKey: testPaperQueryKey(testId),
    queryFn: () => api.admin.tests.readPaper(testId),
    enabled: testId !== '',
  });

  const assignments = useQuery({
    queryKey: testAssignmentsQueryKey(testId),
    queryFn: () => api.admin.assignments.forTest(testId),
    enabled: testId !== '',
  });

  if (test.isLoading || paper.isLoading) {
    // Both have a known shape, so the screen is drawn and held rather than spun at.
    return (
      <div className="flex flex-col gap-4">
        <Skeleton variant="title" />
        <SkeletonParagraph lines={8} />
      </div>
    );
  }

  if (test.error || paper.error || !test.data || !paper.data) {
    const reload = () => Promise.all([test.refetch(), paper.refetch()]);
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Could not load this paper"
        onRetry={reload}
      />
    );
  }

  // Mounted only once both are here, so a refetch cannot throw away a half-edited pool.
  return (
    <TestPaperScreen detail={test.data} paper={paper.data} assignments={assignments.data ?? []} />
  );
}

function TestPaperScreen({
  detail,
  paper,
  assignments,
}: Readonly<{ detail: TestDetail; paper: TestPaper; assignments: readonly Assignment[] }>) {
  const queryClient = useQueryClient();
  // The scope decides which sections this test has a paper for; the rest belong to other tests.
  const sections = scopedSections(detail.baseConfig.sections, detail.scope, detail.scopeRef);

  // The open tab rides the URL, so a link can land on a section and a reload does not lose it.
  const filters = useFilters<'section'>();
  const openSectionId = filters.get('section') || (sections[0]?.id ?? '');
  const [draft, setDraft] = useState<DrawSpec | null>(null);
  const [poolOpen, setPoolOpen] = useState(false);
  // Sticky for the life of the screen: the rebuild is delayed and deduped, so there is nothing to poll.
  const [rescoring, setRescoring] = useState(false);
  const canWrite = useAuth().can(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE);

  const held = useMemo(() => {
    const counts = new Map<string, number>();
    for (const section of paper.sections) {
      counts.set(section.baseConfigSectionId, section.questions.length);
    }
    return counts;
  }, [paper]);

  // The whole paper, not one section: a question sits on it once, wherever it was put.
  const onThePaper = useMemo(
    () => new Set(paper.sections.flatMap((row) => row.questions.map((q) => q.questionId))),
    [paper],
  );

  const save = useMutation({
    meta: { success: 'Drawn from saved.' },
    // Alone on purpose: Setup owns every other field, and a stale copy would undo its last save.
    mutationFn: (next: DrawSpec) => api.admin.tests.update(detail.id, { questionPoolFilter: next }),
    onSuccess: async (saved) => {
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TESTS, refetchType: 'none' });
      queryClient.setQueryData(testQueryKey(saved.id), saved);
    },
  });

  const refresh = async (next: TestPaper) => {
    queryClient.setQueryData(testPaperQueryKey(detail.id), next);
    await queryClient.invalidateQueries({ queryKey: testQueryKey(detail.id) });
  };

  const spec = draft ?? detail.questionPoolFilter ?? NO_SPEC;
  const offered = detail.finalizedAt !== null;
  // What the server assembles: an offered paper is frozen, and a sat one for good.
  const canEditPaper = detail.attemptCount === 0 && !offered;
  // The service refuses it before the offer, so the menu is absent rather than there and refused.
  const canDispose = offered && canWrite;
  const openSection = sections.find((section) => section.id === openSectionId) ?? sections[0];
  const title = detail.title ?? 'Untitled test';
  const chosen = [...held.values()].reduce((sum, count) => sum + count, 0);

  const tail: BreadcrumbItem[] = [{ label: title, to: ROUTES.TEST(detail.id) }, { label: 'Paper' }];

  const header = (
    <PageHeader
      breadcrumbs={<PageCrumbs nav={NAV_ITEMS} tail={tail} />}
      title={title}
      meta={[
        detail.baseConfigName,
        `${chosen} of ${detail.totalQuestions} chosen`,
        durationLabel(detail.durationSec),
      ].join(' · ')}
    />
  );

  // Choosing questions IS saying where they come from, so the picker waits on that decision.
  if (detail.paperSource === null) {
    return (
      <PanelFrame fills header={header}>
        <EmptyState
          title="No paper yet"
          /* ui-copy-ok: rule */
          hint="This test has not said whether its questions are typed for it or picked from the bank."
          action={
            <Link to={ROUTES.TEST(detail.id)} className={linkVariants()}>
              Open the builder
            </Link>
          }
        />
      </PanelFrame>
    );
  }

  if (!openSection) {
    return (
      <PanelFrame fills header={header}>
        <Alert variant="warning">
          This test&rsquo;s configuration has no sections, so there is no paper to build.
        </Alert>
      </PanelFrame>
    );
  }

  // A typed paper is its typists' choice: nothing to draw from, nothing to fill, nothing to save.
  const framed = detail.paperSource === PAPER_SOURCES.FRAMED;

  // The screen owns these, not any one section, so they ride the toolbar above the strip.
  const banners =
    offered || rescoring ? <PaperBanners frozen={offered} rescoring={rescoring} /> : undefined;

  const stripAction = (
    <StripActions
      dirty={draft !== null}
      canSave={canEditPaper}
      saving={save.isPending}
      poolOpen={poolOpen}
      onPoolOpen={setPoolOpen}
      onSave={() => save.mutate(spec)}
    />
  );

  const tabs = {
    value: openSection.id,
    action: framed ? undefined : stripAction,
    onValueChange: (next: string) => filters.set({ section: next }),
    items: sections.map((section) => ({
      value: section.id,
      label: <SectionTab section={section} held={held} />,
      content: (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          {framed ? null : (
            <DrawnFrom
              testId={detail.id}
              section={section}
              spec={spec.sections[section.id] ?? {}}
              canSave={canEditPaper}
              open={poolOpen}
              onChange={(next) => setDraft({ sections: { ...spec.sections, [section.id]: next } })}
            />
          )}

          <PaperSection
            testId={detail.id}
            paperSource={detail.paperSource}
            section={section}
            spec={spec.sections[section.id] ?? {}}
            onPaper={paper.sections.find((row) => row.baseConfigSectionId === section.id)}
            held={onThePaper}
            editable={canEditPaper && !framed}
            disposable={canDispose}
            typist={holderOf(assignments, section.id, ASSIGNMENT_ROLES.TYPIST) ?? null}
            reader={holderOf(assignments, section.id, ASSIGNMENT_ROLES.PROOFREADER) ?? null}
            attemptCount={detail.attemptCount}
            onRescoring={() => setRescoring(true)}
            poolDirty={draft !== null}
            onChanged={refresh}
          />
        </div>
      ),
    })),
  };

  return <PanelFrame fills header={header} toolbar={banners} tabs={tabs} />;
}

/** What the screen says about the paper as a whole, above the section strip. */
function PaperBanners({ frozen, rescoring }: Readonly<{ frozen: boolean; rescoring: boolean }>) {
  return (
    <div className="flex flex-col gap-4 pb-4">
      {frozen ? <Alert variant="info">{PAPER_IS_FROZEN}</Alert> : null}
      {rescoring ? <Alert variant="info">{RE_SCORING_RUNS}</Alert> : null}
    </div>
  );
}

/** A tab names its section and says how far off it is, because only one section is open. */
function SectionTab({
  section,
  held,
}: Readonly<{ section: BaseConfigSection; held: ReadonlyMap<string, number> | null }>) {
  const fullness = sectionFullness(section, held);
  const tally = sectionTally(section, held);

  return (
    <span className="flex items-center gap-2">
      {section.name}
      {fullness && tally ? <Badge variant={FULLNESS_VARIANT[fullness]}>{tally}</Badge> : null}
    </span>
  );
}

/** What the open section is acted on with, held at the tab strip's right end beside the tabs. */
function StripActions({
  dirty,
  canSave,
  saving,
  poolOpen,
  onPoolOpen,
  onSave,
}: Readonly<{
  dirty: boolean;
  canSave: boolean;
  saving: boolean;
  poolOpen: boolean;
  onPoolOpen: (open: boolean) => void;
  onSave: () => void;
}>) {
  const poolLabel = poolOpen ? 'Hide what this section draws from' : 'What this section draws from';

  return (
    <>
      {dirty ? <Badge variant="warning">Unsaved</Badge> : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="iconSm"
            aria-expanded={poolOpen}
            onClick={() => onPoolOpen(!poolOpen)}
          >
            <SlidersHorizontal aria-hidden />
            <span className="sr-only">{poolLabel}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{poolLabel}</TooltipContent>
      </Tooltip>
      {canSave ? (
        <Button size="sm" disabled={!dirty} loading={saving} onClick={onSave}>
          Save
        </Button>
      ) : null}
    </>
  );
}

/** What the open section draws from, folded away where the lists below need the pane. */
function DrawnFrom({
  testId,
  section,
  spec,
  canSave,
  open,
  onChange,
}: Readonly<{
  testId: string;
  section: BaseConfigSection;
  spec: SectionDrawSpec;
  canSave: boolean;
  open: boolean;
  onChange: (next: SectionDrawSpec) => void;
}>) {
  // Nothing at all when folded: an empty section is still a flex child, and still takes the gap.
  if (!open) return null;

  return (
    // Capped so the lists below keep their share, and `relative` so an sr-only label stays in.
    <section className={cn('relative pr-2', CAPPED_VIEWPORT)}>
      {/* A fieldset reaches the pickers `disabled` does not; `contents` keeps it out of the layout. */}
      <fieldset disabled={!canSave} className="contents">
        <DrawSpecEditor
          testId={testId}
          section={section}
          spec={spec}
          disabled={!canSave}
          onChange={onChange}
        />
      </fieldset>
    </section>
  );
}

/** Only what the server said: anything else is not field-mapped, so the toast owns it. */
function refusalMessage(error: unknown, ...keys: readonly string[]): string | null {
  if (!AppException.is(error)) return null;
  const fields = error.fieldErrors ?? {};
  return keys.map((key) => fields[key]?.[0]).find(Boolean) ?? error.message;
}

/** The bank and the paper side by side, and the two ways a section is filled from one. */
function PaperSection({
  testId,
  paperSource,
  section,
  spec,
  onPaper,
  held,
  editable,
  disposable,
  attemptCount,
  poolDirty,
  onChanged,
  onRescoring,
  typist,
  reader,
}: Readonly<{
  testId: string;
  /** A framed section is its typist's work, so there is no remainder for the bank to fill. */
  paperSource: PaperSource | null;
  section: BaseConfigSection;
  spec: SectionDrawSpec;
  /** The section as the paper holds it, and whether its hand-over would be taken now. */
  onPaper: TestPaper['sections'][number] | undefined;
  /** Every question the whole paper holds, since one sits on it once wherever it was put. */
  held: ReadonlySet<string>;
  editable: boolean;
  /** An offered paper's one permitted change, and only for somebody who may write tests. */
  disposable: boolean;
  attemptCount: number;
  /** Both writes draw from the stored pool, so an unsaved one has to stop them. */
  poolDirty: boolean;
  onChanged: (next: TestPaper) => Promise<void>;
  onRescoring: () => void;
  typist: Assignment | null;
  reader: Assignment | null;
}>) {
  const [picked, setPicked] = useState<QuestionPicks>(NO_PICKS);
  const rows = onPaper?.questions ?? [];
  const released = Boolean(reader?.finalizedAt);
  const withReader = Boolean(reader?.handedAt) && !released;
  const framed = paperSource === PAPER_SOURCES.FRAMED;

  const add = useMutation({
    meta: { success: 'Added to the paper.', fields: ADD_ERROR_FIELDS },
    mutationFn: (questionIds: readonly string[]) =>
      api.admin.tests.addPaperQuestions(testId, {
        baseConfigSectionId: section.id,
        questionIds: [...questionIds],
      }),
    onSuccess: async (next) => {
      setPicked(NO_PICKS);
      await onChanged(next);
    },
  });

  const fill = useMutation({
    meta: { success: 'Section filled.', fields: [section.id, FORM_LEVEL_FIELD] },
    mutationFn: () => api.admin.tests.fillPaperSection(testId, section.id),
    onSuccess: onChanged,
  });

  const quota = sectionQuota(
    spec.mix,
    rows.map((row) => row.question.difficulty),
  );
  const refused = refusalMessage(add.error);
  const shortfall = refusalMessage(fill.error, section.id, FORM_LEVEL_FIELD);

  const addAction = (
    <Button
      size="sm"
      disabled={picked.size === 0 || poolDirty}
      loading={add.isPending}
      onClick={() => add.mutate([...picked.keys()])}
    >
      {picked.size === 0 ? 'Add' : `Add ${picked.size}`}
    </Button>
  );

  // A framed section arrives here uneditable, so picking is the picked source's alone.
  const picking = editable && !withReader;
  const fillAction =
    picking && rows.length < section.questionCount ? (
      <FillButton disabled={poolDirty} loading={fill.isPending} onFill={() => fill.mutate()} />
    ) : null;

  const shortfallBanner = shortfall ? (
    <Alert variant="danger" className="shrink-0">
      {shortfall}
    </Alert>
  ) : null;

  // A typed section reaches its owner when its reader releases it, and not a question before.
  if (framed && !released) {
    return <Alert variant="info">{whereTypedWorkIs(typist, reader)}</Alert>;
  }

  const handOver =
    picking && onPaper?.canHandOver ? (
      <HandOverButton testId={testId} section={section} onChanged={onChanged} />
    ) : null;

  return (
    <>
      {refused ? (
        <Alert variant="danger" className="shrink-0">
          {refused}
        </Alert>
      ) : null}
      {withReader ? (
        <Alert variant="info" className="shrink-0">
          With its proof-reader until they release it. Its paper cannot change before then.
        </Alert>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        {picking ? (
          <>
            <QuestionChooser
              testId={testId}
              paperSource={paperSource}
              section={section}
              spec={spec}
              quota={quota}
              held={held}
              picking={{ picked, onPicked: setPicked, action: addAction }}
            />
            {/* Only where they sit side by side: stacked, the gap already separates them. */}
            <Separator orientation="vertical" dashed className="hidden lg:block" />
          </>
        ) : null}

        <PaperQuestions
          testId={testId}
          section={section}
          rows={rows}
          spec={spec}
          editable={picking}
          disposition={disposable ? { attemptCount, onRescoring } : undefined}
          action={
            <>
              {fillAction}
              {handOver}
            </>
          }
          banner={shortfallBanner}
          onChanged={onChanged}
        />
      </div>
    </>
  );
}

function FillButton({
  disabled,
  loading,
  onFill,
}: Readonly<{ disabled: boolean; loading: boolean; onFill: () => void }>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A span, because a disabled button fires no pointer events and the tooltip needs one. */}
        <span>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            loading={loading}
            onClick={onFill}
          >
            Fill remaining
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>Tops the section up from the bank, within its split</TooltipContent>
    </Tooltip>
  );
}

/** Where a typed section stands before its reader releases it to the owner. */
function whereTypedWorkIs(typist: Assignment | null, reader: Assignment | null): string {
  if (!typist) return 'Nobody types this section yet. Give it a typist in the builder.';
  if (!typist.finalizedAt) return `With ${typist.assigneeName} until they mark it done.`;
  if (!reader) return 'Typed. Give it a proof-reader in the builder.';
  return `With ${reader.assigneeName} until they release it.`;
}

/** A picked section, full, handed to its reader from where it was picked. */
function HandOverButton({
  testId,
  section,
  onChanged,
}: Readonly<{
  testId: string;
  section: BaseConfigSection;
  onChanged: (next: TestPaper) => Promise<void>;
}>) {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const handOver = useMutation({
    meta: { success: `${section.name} handed to its proof-reader.` },
    mutationFn: () => api.admin.tests.handOverSection(testId, section.id),
    onSuccess: async (next) => {
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ASSIGNMENTS });
      await onChanged(next);
      setAsking(false);
    },
  });

  return (
    <>
      <Button size="sm" onClick={() => setAsking(true)}>
        Hand over to proof-reader
      </Button>
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title={`Hand ${section.name} to its proof-reader?`}
        description={`Its ${plural(section.questionCount, 'question')} go to the proof-reader to check. This section's paper cannot change until they release it.`}
        confirmLabel="Hand over"
        loading={handOver.isPending}
        onConfirm={() => handOver.mutate()}
      />
    </>
  );
}
