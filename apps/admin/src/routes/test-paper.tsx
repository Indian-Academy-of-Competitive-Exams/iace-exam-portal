import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  AppException,
  FORM_LEVEL_FIELD,
  PAPER_BINDING,
  TEST_BUILDER_STEP,
  sectionQuota,
  scopedSections,
  type BaseConfigSection,
  type DrawSpec,
  type PaperRow,
  type SectionDrawSpec,
  type TestDetail,
  type TestPaper,
} from '@iace/contracts';
import { PageCrumbs, useFilters } from '@iace/app-kit/browser';
import {
  Alert,
  Badge,
  Button,
  CAPPED_VIEWPORT,
  Combobox,
  PageHeader,
  PanelFrame,
  SectionHeading,
  Skeleton,
  SkeletonParagraph,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
  plural,
  type BreadcrumbItem,
} from '@iace/ui';
import { api } from '../lib/api';
import { DrawSpecEditor } from '../components/draw-spec';
import { PaperQuestions } from '../components/paper-questions';
import { QuestionChooser, type QuestionPicks } from '../components/question-picker';
import {
  canPickPaper,
  hasPaper,
  paperOptions,
  sectionFullness,
  sectionTally,
} from './test-paper-view';
import { NAV_ITEMS, QUERY_KEYS, ROUTES } from '../lib/constants';

/** One test's paper on a whole screen: the sections down the side, the work beside them. */

const TEST_KEY = (testId: string) => [...QUERY_KEYS.TEST, testId] as const;
const PAPER_KEY = (testId: string, variant: number) =>
  [...QUERY_KEYS.TEST_PAPER, testId, variant] as const;

/** The paper every FIXED test has, and the first one a GENERATED test drew. */
const FIRST_PAPER = 0;

/** Referentially stable, so a test that has never had a pool does not remount the editor. */
const NO_SPEC: DrawSpec = { sections: {} };
const NO_PICKS: QuestionPicks = new Map();

/** A batch is refused whole, under whichever of these keys the server reached for. */
const ADD_ERROR_FIELDS = ['questionId', 'questionIds', FORM_LEVEL_FIELD] as const;

/** Both read the record, so a pool that is only on screen is a pool they will not draw from. */
const UNSAVED_POOL =
  'Adding and filling read the saved pool, so neither runs until this change is saved.';

/** The Offer step's own words, so both screens name one price for the same edit. */
const THAWS_THE_TEST = 'Editing the paper takes the test back out until it is offered again.';

export function TestPaperPage() {
  const { id } = useParams();
  const testId = id ?? '';
  const [variant, setVariant] = useState(FIRST_PAPER);

  const test = useQuery({
    queryKey: TEST_KEY(testId),
    queryFn: () => api.admin.tests.detail(testId),
    enabled: testId !== '',
  });

  const paper = useQuery({
    queryKey: PAPER_KEY(testId, variant),
    queryFn: () => api.admin.tests.readPaper(testId, variant),
    enabled: testId !== '',
    // The last paper holds the screen while the next one loads, so the open section stays open.
    placeholderData: keepPreviousData,
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
    return <Alert variant="danger">Could not load this paper.</Alert>;
  }

  // Mounted only once both are here, so a refetch cannot throw away a half-edited pool.
  return (
    <TestPaperScreen
      detail={test.data}
      paper={paper.data}
      variant={variant}
      onVariant={setVariant}
      loading={paper.isPlaceholderData}
    />
  );
}

function TestPaperScreen({
  detail,
  paper,
  variant,
  onVariant,
  loading,
}: Readonly<{
  detail: TestDetail;
  paper: TestPaper;
  variant: number;
  onVariant: (variant: number) => void;
  /** True while the paper on screen is the one picked before this one. */
  loading: boolean;
}>) {
  const queryClient = useQueryClient();
  // The scope decides which sections this test has a paper for; the rest belong to other tests.
  const sections = scopedSections(detail.baseConfig.sections, detail.scope, detail.scopeRef);
  const byHand = detail.paperBinding === PAPER_BINDING.FIXED;
  const paperExists = hasPaper(detail);

  // The open tab rides the URL, so a link can land on a section and a reload does not lose it.
  const filters = useFilters<'section'>();
  const openSectionId = filters.get('section') || (sections[0]?.id ?? '');
  const [draft, setDraft] = useState<DrawSpec | null>(null);

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
      queryClient.setQueryData(TEST_KEY(saved.id), saved);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TESTS });
    },
  });

  const refresh = async (next: TestPaper) => {
    queryClient.setQueryData(PAPER_KEY(detail.id, variant), next);
    await queryClient.invalidateQueries({ queryKey: TEST_KEY(detail.id) });
  };

  const spec = draft ?? detail.questionPoolFilter ?? NO_SPEC;
  const unsat = detail.attemptCount === 0;
  // What the server assembles: a sat test and a drawn one are refused, a frozen one is thawed.
  const canEditPaper = unsat && byHand;
  // Saving the pool moves the paper, so on a frozen test it would thaw the finalize away.
  const canSaveSpec = unsat && !detail.isLocked;
  const openSection = sections.find((section) => section.id === openSectionId) ?? sections[0];
  const title = detail.title ?? 'Untitled test';
  const chosen = [...held.values()].reduce((sum, count) => sum + count, 0);

  const tail: BreadcrumbItem[] = [{ label: title, to: ROUTES.TEST(detail.id) }, { label: 'Paper' }];

  const header = (
    <PageHeader
      breadcrumbs={<PageCrumbs nav={NAV_ITEMS} tail={tail} />}
      title={title}
      meta={
        byHand
          ? `${chosen} of ${detail.totalQuestions} chosen`
          : `${plural(detail.variantCount, 'paper')} · ${plural(detail.totalQuestions, 'question')}`
      }
      action={
        canPickPaper(detail) ? (
          <PaperPicker count={detail.variantCount} variant={variant} onVariant={onVariant} />
        ) : null
      }
    />
  );

  if (!openSection) {
    return (
      <PanelFrame fills header={header}>
        <Alert variant="warning">
          This test&rsquo;s configuration has no sections, so there is no paper to build.
        </Alert>
      </PanelFrame>
    );
  }

  // The picked paper's counts or none: the last one's tallies under this one's name is a lie.
  const tallies = paperExists && !loading ? held : null;

  const thaws = canEditPaper && detail.isLocked;
  // The screen owns these, not any one section, so they ride the toolbar above the strip.
  const banners =
    paperExists && !thaws ? undefined : (
      <div className="flex flex-col gap-4 pb-4">
        {paperExists ? null : <DrawnAtOffer detail={detail} />}
        {thaws ? <Alert variant="warning">{THAWS_THE_TEST}</Alert> : null}
      </div>
    );

  const tabs = {
    value: openSection.id,
    onValueChange: (next: string) => filters.set({ section: next }),
    items: sections.map((section) => ({
      value: section.id,
      label: <SectionTab section={section} held={tallies} />,
      content: (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <DrawnFrom
            section={section}
            spec={spec.sections[section.id] ?? {}}
            canSave={canSaveSpec}
            fills={!paperExists}
            dirty={draft !== null}
            saving={save.isPending}
            onSave={() => save.mutate(spec)}
            onChange={(next) => setDraft({ sections: { ...spec.sections, [section.id]: next } })}
          />

          {paperExists ? (
            <SectionWorkspace
              testId={detail.id}
              section={section}
              spec={spec.sections[section.id] ?? {}}
              rows={
                paper.sections.find((row) => row.baseConfigSectionId === section.id)?.questions ??
                []
              }
              held={onThePaper}
              editable={canEditPaper}
              loading={loading}
              poolDirty={draft !== null}
              onChanged={refresh}
            />
          ) : null}
        </div>
      ),
    })),
  };

  return <PanelFrame fills header={header} toolbar={banners} tabs={tabs} />;
}

/** Amber only where work has started and stalled: an untouched section is not a warning. */
const CHIP_VARIANT = {
  EMPTY: 'neutral',
  SHORT: 'warning',
  FULL: 'success',
} as const;

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
      {fullness && tally ? <Badge variant={CHIP_VARIANT[fullness]}>{tally}</Badge> : null}
    </span>
  );
}

/** Which of the drawn papers is on screen. */
function PaperPicker({
  count,
  variant,
  onVariant,
}: Readonly<{ count: number; variant: number; onVariant: (variant: number) => void }>) {
  const items = useMemo(() => paperOptions(count), [count]);

  return (
    <Combobox
      aria-label="Paper"
      className="w-44"
      clearable={false}
      value={String(variant)}
      onChange={(next) => onVariant(Number(next))}
      items={items}
    />
  );
}

/** The one thing this screen cannot show a drawn test: papers the finalize has not drawn yet. */
function DrawnAtOffer({ detail }: Readonly<{ detail: TestDetail }>) {
  const papers = detail.variantCount === 1 ? 'paper is' : 'papers are';

  return (
    <Alert variant="info" className="shrink-0">
      <span className="flex flex-1 flex-wrap items-center justify-between gap-3">
        <span>
          {`Its ${detail.variantCount} ${papers} drawn the moment this test is offered, so there is nothing on them to read yet.`}
        </span>
        <Button size="sm" variant="outline" asChild>
          <Link to={ROUTES.TEST(detail.id)} state={{ step: TEST_BUILDER_STEP.OFFER }}>
            Offer this test
          </Link>
        </Button>
      </span>
    </Alert>
  );
}

/** What the open section draws from, folded away where the lists below need the pane. */
function DrawnFrom({
  section,
  spec,
  canSave,
  fills,
  dirty,
  saving,
  onSave,
  onChange,
}: Readonly<{
  section: BaseConfigSection;
  spec: SectionDrawSpec;
  canSave: boolean;
  /** True where it is the whole pane, which is the only time it opens on arrival. */
  fills: boolean;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onChange: (next: SectionDrawSpec) => void;
}>) {
  const [open, setOpen] = useState(fills);
  const label = open ? 'Hide drawn from' : 'Show drawn from';
  const Glyph = open ? ChevronUp : ChevronDown;

  const save = canSave ? (
    <Button size="sm" disabled={!dirty} loading={saving} onClick={onSave}>
      Save
    </Button>
  ) : null;

  return (
    <section className={cn('flex flex-col gap-3', fills ? 'min-h-0 flex-1' : 'shrink-0')}>
      <SectionHeading
        className="shrink-0"
        title="Drawn from"
        action={
          <span className="flex items-center gap-2">
            {save}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="iconSm"
                  aria-expanded={open}
                  onClick={() => setOpen(!open)}
                >
                  <Glyph aria-hidden />
                  <span className="sr-only">{label}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          </span>
        }
      />

      {dirty && !fills ? (
        <Alert variant="info" className="shrink-0">
          {UNSAVED_POOL}
        </Alert>
      ) : null}

      {open ? (
        // Capped so the lists below keep their share, and `relative` so an sr-only label stays in.
        <div
          className={cn(
            'relative pr-2',
            fills ? 'min-h-0 flex-1 overflow-y-auto' : CAPPED_VIEWPORT,
          )}
        >
          {/* A fieldset reaches the pickers `disabled` does not; `contents` keeps it out of the layout. */}
          <fieldset disabled={!canSave} className="contents">
            <DrawSpecEditor section={section} spec={spec} disabled={!canSave} onChange={onChange} />
          </fieldset>
        </div>
      ) : null}
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
function SectionWorkspace({
  testId,
  section,
  spec,
  rows,
  held,
  editable,
  loading,
  poolDirty,
  onChanged,
}: Readonly<{
  testId: string;
  section: BaseConfigSection;
  spec: SectionDrawSpec;
  rows: readonly PaperRow[];
  /** Every question the whole paper holds, since one sits on it once wherever it was put. */
  held: ReadonlySet<string>;
  editable: boolean;
  /** True while `rows` still belongs to the paper picked before this one. */
  loading: boolean;
  /** Both writes draw from the stored pool, so an unsaved one has to stop them. */
  poolDirty: boolean;
  onChanged: (next: TestPaper) => Promise<void>;
}>) {
  const [picked, setPicked] = useState<QuestionPicks>(NO_PICKS);

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

  const fillAction =
    editable && rows.length < section.questionCount ? (
      <Button
        size="sm"
        variant="outline"
        disabled={poolDirty}
        loading={fill.isPending}
        onClick={() => fill.mutate()}
      >
        Fill remaining
      </Button>
    ) : null;

  const shortfallBanner = shortfall ? (
    <Alert variant="danger" className="shrink-0">
      {shortfall}
    </Alert>
  ) : null;

  return (
    <>
      {refused ? (
        <Alert variant="danger" className="shrink-0">
          {refused}
        </Alert>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        {editable ? (
          <QuestionChooser
            section={section}
            spec={spec}
            quota={quota}
            held={held}
            picking={{ picked, onPicked: setPicked, action: addAction }}
          />
        ) : null}

        <PaperQuestions
          testId={testId}
          section={section}
          rows={rows}
          spec={spec}
          editable={editable}
          isLoading={loading}
          action={fillAction}
          banner={shortfallBanner}
          onChanged={onChanged}
        />
      </div>
    </>
  );
}
