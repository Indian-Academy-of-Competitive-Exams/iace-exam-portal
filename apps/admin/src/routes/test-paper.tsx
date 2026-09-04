import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DrawSpec, TestDetail, TestPaper } from '@iace/contracts';
import { PageCrumbs } from '@iace/app-kit/browser';
import {
  Alert,
  Button,
  PageHeader,
  PaneFrame,
  Skeleton,
  SkeletonParagraph,
  type BreadcrumbItem,
} from '@iace/ui';
import { api } from '../lib/api';
import { DrawSpecEditor } from '../components/draw-spec';
import { PaperSectionRail } from '../components/paper-section-rail';
import { NAV_ITEMS, QUERY_KEYS, ROUTES } from '../lib/constants';

/** One test's paper on a whole screen: the sections down the side, the work beside them. */

const TEST_KEY = (testId: string) => [...QUERY_KEYS.TEST, testId] as const;
const PAPER_KEY = (testId: string) => [...QUERY_KEYS.TEST_PAPER, testId] as const;

/** Referentially stable, so a test that has never had a pool does not remount the editor. */
const NO_SPEC: DrawSpec = { sections: {} };

export function TestPaperPage() {
  const { id } = useParams();
  const testId = id ?? '';

  const test = useQuery({
    queryKey: TEST_KEY(testId),
    queryFn: () => api.admin.tests.detail(testId),
    enabled: testId !== '',
  });

  const paper = useQuery({
    queryKey: PAPER_KEY(testId),
    queryFn: () => api.admin.tests.readPaper(testId),
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
    return <Alert variant="danger">Could not load this paper.</Alert>;
  }

  // Mounted only once both are here, so a refetch cannot throw away a half-edited pool.
  return <TestPaperScreen detail={test.data} paper={paper.data} />;
}

function TestPaperScreen({ detail, paper }: Readonly<{ detail: TestDetail; paper: TestPaper }>) {
  const queryClient = useQueryClient();
  const sections = detail.baseConfig.sections;

  const [openSectionId, setOpenSectionId] = useState(sections[0]?.id ?? '');
  const [collapsed, setCollapsed] = useState(false);
  const [draft, setDraft] = useState<DrawSpec | null>(null);

  const held = useMemo(() => {
    const counts = new Map<string, number>();
    for (const section of paper.sections) {
      counts.set(section.baseConfigSectionId, section.questions.length);
    }
    return counts;
  }, [paper]);

  const save = useMutation({
    meta: { success: 'Pool saved.' },
    // Alone on purpose: Setup owns every other field, and a stale copy would undo its last save.
    mutationFn: (next: DrawSpec) => api.admin.tests.update(detail.id, { questionPoolFilter: next }),
    onSuccess: async (saved) => {
      setDraft(null);
      queryClient.setQueryData(TEST_KEY(saved.id), saved);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TESTS });
    },
  });

  const spec = draft ?? detail.questionPoolFilter ?? NO_SPEC;
  // Saving the pool moves the paper, so on a frozen test it would thaw the finalize away.
  const editable = !detail.isLocked && detail.attemptCount === 0;

  const openSection = sections.find((section) => section.id === openSectionId) ?? sections[0];
  const chosen = [...held.values()].reduce((sum, count) => sum + count, 0);

  const tail: BreadcrumbItem[] = [
    { label: detail.title ?? 'Untitled test', to: ROUTES.TEST(detail.id) },
    { label: 'Paper' },
  ];

  const header = (
    <PageHeader
      breadcrumbs={<PageCrumbs nav={NAV_ITEMS} tail={tail} />}
      title={detail.title ?? 'Untitled test'}
      meta={`${chosen} of ${detail.totalQuestions} chosen`}
    />
  );

  if (!openSection) {
    return (
      <PaneFrame header={header}>
        <Alert variant="warning">
          This test&rsquo;s configuration has no sections, so there is no paper to build.
        </Alert>
      </PaneFrame>
    );
  }

  return (
    <PaneFrame header={header} className="flex gap-4">
      <PaperSectionRail
        sections={sections}
        held={held}
        openSectionId={openSection.id}
        collapsed={collapsed}
        onOpen={setOpenSectionId}
        onCollapsedChange={setCollapsed}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-6">
        <section className="flex min-h-0 flex-col gap-3">
          <div className="flex shrink-0 items-center justify-between gap-3">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">Drawn from</h2>
            {editable ? (
              <Button
                size="sm"
                disabled={draft === null}
                loading={save.isPending}
                onClick={() => save.mutate(spec)}
              >
                Save
              </Button>
            ) : null}
          </div>

          <div className="relative min-h-0 overflow-y-auto pr-2">
            {/* A fieldset reaches the pickers `disabled` does not; `contents` keeps it out of the layout. */}
            <fieldset disabled={!editable} className="contents">
              <DrawSpecEditor
                section={openSection}
                spec={spec.sections[openSection.id] ?? {}}
                disabled={!editable}
                onChange={(next) =>
                  setDraft({ sections: { ...spec.sections, [openSection.id]: next } })
                }
              />
            </fieldset>
          </div>
        </section>
      </div>
    </PaneFrame>
  );
}
