import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import {
  PAPER_BINDING,
  PICK_REFUSAL,
  sectionQuota,
  strandedPicks,
  type BaseConfigSection,
  type PaperRow,
  type DrawSpec,
  type PaperBinding,
  type PaperSection,
  type PickRefusal,
  type SectionDrawSpec,
  type TestDetail,
  type TestPaper,
} from '@iace/contracts';
import {
  Accordion,
  Alert,
  Badge,
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
import { QUERY_KEYS } from '../lib/constants';

/** What the paper holds: the questions chosen for it, and the pool each section chooses from. */

const PAPER_KEY = (testId: string) => [...QUERY_KEYS.TEST_PAPER, testId] as const;

/** What a section's own settings say about a question it is already holding. */
const STRANDED_LABELS: Readonly<Record<PickRefusal, string>> = {
  [PICK_REFUSAL.OFF_TOPIC]: 'Off the topics',
  [PICK_REFUSAL.QUOTA_MET]: 'Over the count',
  [PICK_REFUSAL.SECTION_FULL]: 'Over the count',
};

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
    await queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.TEST, detail.id] });
  };

  const chosen = [...held.values()].reduce((sum, section) => sum + section.questions.length, 0);

  return (
    <div className="flex flex-col gap-6">
      {/* Bled to the card's edges and pinned: the count stays put past twelve sections. */}
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
            <span className="font-medium text-foreground">{`${chosen} of ${detail.totalQuestions}`}</span>
            {' chosen'}
          </p>
        )}
      </div>

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
    </div>
  );
}

/** One lookup, so the badge and the label it carries cannot disagree about the pick. */
function refusalOf(stranded: Readonly<Record<string, PickRefusal>>, questionId: string) {
  const refusal = stranded[questionId];
  if (refusal === undefined) return null;
  return <Badge variant="warning">{STRANDED_LABELS[refusal]}</Badge>;
}

function paperColumns(
  onRemove: (row: PaperRow) => void,
  sat: boolean,
  stranded: Readonly<Record<string, PickRefusal>>,
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
          <span className="flex min-w-0 items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {`${row.question.difficulty.toLowerCase()} · ${row.marks} marks`}
            </span>
            {refusalOf(stranded, row.questionId)}
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
  const onThePaper = new Set(rows.map((row) => row.questionId));

  const picks = rows.map((row) => ({
    questionId: row.questionId,
    difficulty: row.question.difficulty,
    topicId: row.question.topicId,
  }));
  const quota = sectionQuota(
    spec.mix,
    picks.map((pick) => pick.difficulty),
  );
  const stranded = strandedPicks(picks, spec);
  const strandedCount = Object.keys(stranded).length;

  const add = useMutation({
    meta: { success: 'Question added.' },
    mutationFn: (questionId: string) =>
      api.admin.tests.addPaperQuestions(testId, {
        baseConfigSectionId: section.id,
        questionIds: [questionId],
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

        {strandedCount > 0 ? (
          <Alert variant="warning">
            {`${plural(strandedCount, 'question')} on this paper sit outside what ${section.name} now draws from. Take them off, or widen the pool above.`}
          </Alert>
        ) : null}

        {generated ? null : (
          // Side by side: choosing from and building are one job, and stacking them means scrolling.
          <div className="grid gap-6 lg:grid-cols-2">
            <QuestionChooser
              section={section}
              spec={spec}
              quota={quota}
              held={onThePaper}
              onAdd={(question) => add.mutate(question.id)}
              disabled={sat}
            />

            <section className="flex min-w-0 flex-col gap-3">
              <h3 className="text-sm font-semibold tracking-tight text-foreground">
                {`On the paper — ${rows.length} of ${section.questionCount}`}
              </h3>
              <DataTable
                columns={paperColumns(setRemoving, sat, stranded)}
                rows={rows}
                rowKey={(row) => row.id}
                isLoading={false}
                scroll={{ hasMore: false }}
                empty="Nothing chosen for this section yet. Add questions from the bank."
              />
            </section>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        destructive
        title={`Remove question ${removing?.order ?? ''} from ${section.name}?`}
        description={`${section.name} drops to ${rows.length - 1} of the ${section.questionCount} it needs, so this test cannot be offered until one is chosen in its place.`}
        confirmLabel="Remove question"
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </Accordion>
  );
}
