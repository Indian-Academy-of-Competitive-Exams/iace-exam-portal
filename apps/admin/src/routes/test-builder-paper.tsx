import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dices, Trash2 } from 'lucide-react';
import {
  AppException,
  ErrorCodes,
  PAPER_BINDING,
  type BaseConfigSection,
  type PaperRow,
  type DrawSpec,
  type PaperBinding,
  type PaperSection,
  type SectionDrawSpec,
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
import { DrawSpecEditor } from '../components/draw-spec';
import { QuestionLink } from '../components/question-viewer';

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
      ? `The ${plural(drawn, 'question')} already on this paper are kept, and the draw fills what is short. `
      : '';
  const thaw = detail.isLocked
    ? 'This test is finalized, so drawing unfreezes its paper and stops it being offered until you offer it again. '
    : '';
  return `${replaced}${thaw}Every student sits whatever this draw produces.`;
}

export function PaperStep({
  detail,
  spec,
  onSpec,
  paperBinding,
}: Readonly<{
  detail: TestDetail;
  spec: DrawSpec;
  onSpec: (next: DrawSpec) => void;
  paperBinding: PaperBinding;
}>) {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const sat = detail.attemptCount > 0;
  const generated = paperBinding === PAPER_BINDING.GENERATED;

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
      // Everything already on the paper is kept: a draw fills what is short, it does not undo work.
      api.admin.tests.assemblePaper(detail.id, {
        spec,
        manual: [...held.values()].map((section) => ({
          baseConfigSectionId: section.baseConfigSectionId,
          questionIds: section.questions.map((row) => row.questionId),
        })),
      }),
    onSuccess: async (next) => {
      setAsking(false);
      await refresh(next);
    },
    onError: () => setAsking(false),
  });

  const gaps = shortfallsOf(draw.error);
  const drawn = [...held.values()].reduce((sum, section) => sum + section.questions.length, 0);

  return (
    <div className="flex flex-col gap-6">
      {/* Bled to the card's edges and pinned: the count and the draw stay put past twelve sections. */}
      <div className="sticky -top-[41px] z-10 -mx-6 -mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-6 pb-3 pt-6">
        {generated ? (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {plural(detail.variantCount, 'paper')}
            </span>
            {', drawn from this when the test is offered'}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{`${drawn} of ${detail.totalQuestions}`}</span>
            {' drawn'}
          </p>
        )}

        {sat || generated ? null : (
          <Button type="button" size="sm" onClick={() => setAsking(true)} loading={draw.isPending}>
            <Dices aria-hidden />
            {drawn > 0 ? 'Fill the rest' : 'Draw the paper'}
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

      {generated ? (
        <Alert variant="info">
          Every student gets one of these papers, drawn when the test is offered rather than while
          you watch. What each section is drawn FROM is set here, and it shapes all of them.
        </Alert>
      ) : null}

      {paper.isLoading && !generated ? (
        <SkeletonParagraph lines={detail.baseConfig.sections.length} />
      ) : null}

      <div className="flex flex-col gap-3">
        {paper.isLoading && !generated
          ? null
          : detail.baseConfig.sections.map((section, index) => (
              <SectionPaper
                key={section.id}
                testId={detail.id}
                section={section}
                open={index === 0}
                generated={generated}
                held={held.get(section.id)}
                sat={sat}
                spec={spec.sections[section.id] ?? {}}
                onSpec={(next) => onSpec({ sections: { ...spec.sections, [section.id]: next } })}
                onChanged={refresh}
              />
            ))}
      </div>

      <ConfirmDialog
        open={asking}
        onOpenChange={(open) => !open && setAsking(false)}
        title={drawn > 0 ? 'Fill the rest of this paper?' : 'Draw the paper?'}
        description={drawDescription(detail, drawn)}
        confirmLabel={drawn > 0 ? 'Fill the rest' : 'Draw the paper'}
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
      key: 'question',
      header: 'Question',
      // Beside the bank in half a screen: what it is and how hard, on one line each.
      className: 'w-full max-w-0',
      cell: (row) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <QuestionLink questionId={row.questionId}>
            <TruncatedText className="font-mono">{row.question.questionCode}</TruncatedText>
          </QuestionLink>
          <span className="text-xs text-muted-foreground">
            {`${row.question.difficulty.toLowerCase()} · ${row.marks} marks`}
          </span>
        </span>
      ),
    },
    ...actions,
  ];
}

function SectionPaper({
  testId,
  section,
  open,
  generated,
  held,
  sat,
  spec,
  onSpec,
  onChanged,
}: Readonly<{
  testId: string;
  section: BaseConfigSection;
  /** The first one, so the step does not read as a stack of empty rows. */
  open: boolean;
  /** A generated test has a paper per student, so there is no one paper to show or pin against. */
  generated: boolean;
  held: PaperSection | undefined;
  sat: boolean;
  spec: SectionDrawSpec;
  onSpec: (next: SectionDrawSpec) => void;
  onChanged: (next: TestPaper) => Promise<void>;
}>) {
  const [removing, setRemoving] = useState<PaperRow | null>(null);
  const rows = held?.questions ?? [];
  const short = rows.length < section.questionCount;
  const full = !short;
  const onThePaper = new Set(rows.map((row) => row.questionId));

  const add = useMutation({
    meta: { success: 'Question added.' },
    mutationFn: (questionId: string) =>
      api.admin.tests.addPaperQuestion(testId, {
        baseConfigSectionId: section.id,
        questionId,
      }),
    onSuccess: onChanged,
  });

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
      defaultOpen={open}
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
          <h3 className="text-sm font-semibold tracking-tight text-foreground">Drawn from</h3>
          <DrawSpecEditor section={section} spec={spec} onChange={onSpec} disabled={sat} />
        </section>

        {generated ? null : (
          // Side by side: choosing from and building are one job, and stacking them means scrolling.
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="flex min-w-0 flex-col gap-3">
              <h3 className="text-sm font-semibold tracking-tight text-foreground">The bank</h3>
              <QuestionChooser
                subjectId={section.subjectId}
                held={onThePaper}
                onAdd={(question) => add.mutate(question.id)}
                disabled={sat || full}
              />
              {full ? (
                <p className="text-sm text-muted-foreground">
                  {`${section.name} is full. Take one off to put another on.`}
                </p>
              ) : null}
            </section>

            <section className="flex min-w-0 flex-col gap-3">
              <h3 className="text-sm font-semibold tracking-tight text-foreground">
                {`On the paper — ${rows.length} of ${section.questionCount}`}
              </h3>
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
                  Nothing here yet. Draw the paper, or add questions from the bank.
                </p>
              )}
            </section>
          </div>
        )}
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
