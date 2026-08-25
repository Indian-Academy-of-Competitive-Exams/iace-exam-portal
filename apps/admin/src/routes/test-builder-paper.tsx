import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dices, Trash2 } from 'lucide-react';
import {
  AppException,
  ErrorCodes,
  PAPER_BINDING,
  type BaseConfigSection,
  type PaperRow,
  type PaperSection,
  type TestDetail,
  type TestPaper,
} from '@iace/contracts';
import {
  Accordion,
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  DropdownMenuItem,
  RowActions,
  SkeletonParagraph,
  TruncatedText,
  plural,
  type DataTableColumn,
} from '@iace/ui';
import { api } from '../lib/api';
import { QuestionChooser } from '../components/question-picker';

/** What the paper holds: the questions on it, the ones pinned by hand, and the draw. */

const PAPER_KEY = (testId: string) => ['admin', 'test-paper', testId] as const;

/** A draw that could not fill a section answers with one message per section id. */
function shortfallsOf(error: unknown): string[] {
  if (!AppException.is(error) || error.code !== ErrorCodes.DRAW_SHORTFALL) return [];
  return Object.values(error.fieldErrors ?? {}).flat();
}

/** Says what a draw costs, so the standing alerts that used to say it can go. */
function drawDescription(detail: TestDetail, drawn: number): string {
  const replaced =
    drawn > 0
      ? `The ${plural(drawn, 'question')} already on this paper are replaced, keeping only what you have chosen by hand. `
      : '';
  const thaw = detail.isLocked
    ? 'This test is finalized, so drawing unfreezes its paper and stops it being offered until you offer it again. '
    : '';
  return `${replaced}${thaw}Every student sits whatever this draw produces.`;
}

export function PaperStep({ detail }: Readonly<{ detail: TestDetail }>) {
  const queryClient = useQueryClient();
  const [manual, setManual] = useState<Record<string, string[]>>({});
  const [asking, setAsking] = useState(false);
  const sat = detail.attemptCount > 0;
  const generated = detail.paperBinding === PAPER_BINDING.GENERATED;

  const paper = useQuery({
    queryKey: PAPER_KEY(detail.id),
    queryFn: () => api.admin.tests.readPaper(detail.id),
    enabled: !generated,
  });

  const held = useMemo(() => {
    const sections = new Map<string, PaperSection>();
    for (const section of paper.data?.sections ?? []) {
      sections.set(section.baseConfigSectionId, section);
    }
    return sections;
  }, [paper.data]);

  const refresh = async (next: TestPaper) => {
    queryClient.setQueryData(PAPER_KEY(detail.id), next);
    await queryClient.invalidateQueries({ queryKey: ['admin', 'test', detail.id] });
  };

  const draw = useMutation({
    meta: { success: 'Paper drawn.' },
    mutationFn: () =>
      api.admin.tests.assemblePaper(detail.id, {
        manual: Object.entries(manual)
          .filter(([, questionIds]) => questionIds.length > 0)
          .map(([baseConfigSectionId, questionIds]) => ({ baseConfigSectionId, questionIds })),
      }),
    onSuccess: async (next) => {
      setAsking(false);
      await refresh(next);
    },
    onError: () => setAsking(false),
  });

  if (generated) {
    return (
      <Alert variant="info">
        This test draws a fresh paper for each student when their attempt starts, so there is no one
        paper to build here. Switch it back to a fixed paper on Setup if every student should sit
        the same questions.
      </Alert>
    );
  }

  const gaps = shortfallsOf(draw.error);
  const drawn = [...held.values()].reduce((sum, section) => sum + section.questions.length, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{`${drawn} of ${detail.totalQuestions}`}</span>
          {' drawn'}
        </p>

        {sat ? null : (
          <Button type="button" onClick={() => setAsking(true)} loading={draw.isPending}>
            <Dices aria-hidden />
            {drawn > 0 ? 'Draw again' : 'Draw the paper'}
          </Button>
        )}
      </div>

      {gaps.length > 0 ? (
        <Alert variant="warning">
          <span className="flex flex-col gap-1">
            <span>The bank cannot fill this paper yet, so nothing was drawn.</span>
            {gaps.map((gap) => (
              <span key={gap}>{gap}</span>
            ))}
          </span>
        </Alert>
      ) : null}

      {paper.isLoading ? <SkeletonParagraph lines={detail.baseConfig.sections.length} /> : null}

      <div className="flex flex-col gap-3">
        {paper.isLoading
          ? null
          : detail.baseConfig.sections.map((section) => (
              <SectionPaper
                key={section.id}
                testId={detail.id}
                section={section}
                held={held.get(section.id)}
                pinned={manual[section.id] ?? []}
                sat={sat}
                onPin={(next) => setManual((chosen) => ({ ...chosen, [section.id]: next }))}
                onChanged={refresh}
              />
            ))}
      </div>

      <ConfirmDialog
        open={asking}
        onOpenChange={(open) => !open && setAsking(false)}
        title={drawn > 0 ? 'Draw this paper again?' : 'Draw the paper?'}
        description={drawDescription(detail, drawn)}
        confirmLabel={drawn > 0 ? 'Draw again' : 'Draw the paper'}
        loading={draw.isPending}
        onConfirm={() => draw.mutate()}
      />
    </div>
  );
}

function paperColumns(
  onRemove: (row: PaperRow) => void,
  sat: boolean,
): DataTableColumn<PaperRow>[] {
  const actions: DataTableColumn<PaperRow>[] = sat
    ? []
    : [
        {
          key: 'actions',
          className: 'text-right',
          cell: (row) => (
            <RowActions label={`Actions for question ${row.order}`}>
              <DropdownMenuItem destructive onSelect={() => onRemove(row)}>
                <Trash2 aria-hidden />
                Remove
              </DropdownMenuItem>
            </RowActions>
          ),
        },
      ];

  return [
    { key: 'order', header: '#', numeric: true, cell: (row) => row.order },
    {
      key: 'code',
      header: 'Code',
      className: 'max-w-[10rem] font-mono text-sm',
      cell: (row) => <TruncatedText>{row.question.questionCode}</TruncatedText>,
    },
    {
      key: 'difficulty',
      header: 'Difficulty',
      cell: (row) => <Badge variant="neutral">{row.question.difficulty}</Badge>,
    },
    { key: 'marks', header: 'Marks', numeric: true, cell: (row) => row.marks },
    ...actions,
  ];
}

function SectionPaper({
  testId,
  section,
  held,
  pinned,
  sat,
  onPin,
  onChanged,
}: Readonly<{
  testId: string;
  section: BaseConfigSection;
  held: PaperSection | undefined;
  pinned: readonly string[];
  sat: boolean;
  onPin: (next: string[]) => void;
  onChanged: (next: TestPaper) => Promise<void>;
}>) {
  const [removing, setRemoving] = useState<PaperRow | null>(null);
  const rows = held?.questions ?? [];
  const short = rows.length < section.questionCount;

  const remove = useMutation({
    meta: { success: 'Question removed.' },
    mutationFn: (rowId: string) => api.admin.tests.removePaperQuestion(testId, rowId),
    onSuccess: async (next) => {
      setRemoving(null);
      await onChanged(next);
    },
  });

  return (
    <Accordion
      title={<span className="font-medium text-foreground">{section.name}</span>}
      meta={
        <span className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
          <span>{`${rows.length} of ${section.questionCount}`}</span>
          {short ? <Badge variant="warning">Short</Badge> : <Badge variant="success">Full</Badge>}
        </span>
      }
    >
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">On the paper</h3>
          {rows.length > 0 ? (
            <DataTable
              columns={paperColumns(setRemoving, sat)}
              rows={rows}
              rowKey={(row) => row.id}
              isLoading={false}
              empty="Nothing drawn for this section yet."
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing drawn for this section yet. Choose what you want kept below, then draw.
            </p>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">Choose by hand</h3>
          <QuestionChooser
            subjectId={section.subjectId}
            chosen={pinned}
            onChosen={onPin}
            needed={section.questionCount}
            disabled={sat}
          />
        </section>
      </div>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        destructive
        title={`Remove question ${removing?.order ?? ''} from ${section.name}?`}
        description={`${section.name} drops to ${rows.length - 1} of the ${section.questionCount} it needs, so this test cannot be offered until one is drawn in its place.`}
        confirmLabel="Remove question"
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </Accordion>
  );
}
