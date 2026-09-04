import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import {
  PICK_REFUSAL,
  strandedPicks,
  type BaseConfigSection,
  type PaperRow,
  type PickRefusal,
  type SectionDrawSpec,
  type TestPaper,
} from '@iace/contracts';
import {
  Alert,
  Badge,
  ConfirmDialog,
  DataTable,
  DropdownMenuItem,
  RowActions,
  SectionHeading,
  TruncatedText,
  plural,
  type DataTableColumn,
} from '@iace/ui';
import { api } from '../lib/api';
import { QuestionLink } from './question-viewer';

/** One section of the paper as it stands: what is on it, and what its own settings now refuse. */

/** What a section's own settings say about a question it is already holding. */
const STRANDED_LABELS: Readonly<Record<PickRefusal, string>> = {
  [PICK_REFUSAL.OFF_TOPIC]: 'Off the topics',
  [PICK_REFUSAL.QUOTA_MET]: 'Over the count',
  [PICK_REFUSAL.SECTION_FULL]: 'Over the count',
};

/** One lookup, so the badge and the label it carries cannot disagree about the pick. */
function refusalOf(stranded: Readonly<Record<string, PickRefusal>>, questionId: string) {
  const refusal = stranded[questionId];
  if (refusal === undefined) return null;
  return <Badge variant="warning">{STRANDED_LABELS[refusal]}</Badge>;
}

function paperColumns(
  onRemove: ((row: PaperRow) => void) | undefined,
  stranded: Readonly<Record<string, PickRefusal>>,
): DataTableColumn<PaperRow>[] {
  const actions: DataTableColumn<PaperRow>[] = onRemove
    ? [
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
      ]
    : [];

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

export function PaperQuestions({
  testId,
  section,
  rows,
  spec,
  editable,
  isLoading = false,
  action,
  banner,
  onChanged,
}: Readonly<{
  testId: string;
  section: BaseConfigSection;
  rows: readonly PaperRow[];
  /** What the section draws from now, which is what strands a question chosen before it changed. */
  spec: SectionDrawSpec;
  editable: boolean;
  /** True while `rows` are last read's, so the table draws its shape instead of another paper's. */
  isLoading?: boolean;
  /** Beside the heading — filling the rest of this section. */
  action?: ReactNode;
  /** Above the rows — how the last fill was refused. */
  banner?: ReactNode;
  onChanged: (next: TestPaper) => Promise<void>;
}>) {
  const [removing, setRemoving] = useState<PaperRow | null>(null);

  const stranded = strandedPicks(
    rows.map((row) => ({
      questionId: row.questionId,
      difficulty: row.question.difficulty,
      topicId: row.question.topicId,
    })),
    spec,
  );
  const strandedCount = Object.keys(stranded).length;

  const remove = useMutation({
    meta: { success: 'Question removed.' },
    mutationFn: (rowId: string) => api.admin.tests.removePaperQuestion(testId, rowId),
    onSuccess: async (next) => {
      setRemoving(null);
      await onChanged(next);
    },
  });

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <SectionHeading
        className="shrink-0"
        title="On the paper"
        meta={`${rows.length} of ${section.questionCount}`}
        action={action}
      />

      {banner}

      {strandedCount > 0 ? (
        <Alert variant="warning" className="shrink-0">
          {`${plural(strandedCount, 'question')} on this paper sit outside what ${section.name} now draws from. Take them off, or widen the pool above.`}
        </Alert>
      ) : null}

      <DataTable
        columns={paperColumns(editable ? setRemoving : undefined, stranded)}
        rows={rows}
        rowKey={(row) => row.id}
        isLoading={isLoading}
        empty="Nothing chosen for this section yet. Tick questions in the bank and add them."
      />

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
    </section>
  );
}
