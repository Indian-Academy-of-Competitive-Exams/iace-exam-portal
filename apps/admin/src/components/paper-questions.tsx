import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
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
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  SectionHeading,
  TruncatedText,
  plural,
  type DataTableColumn,
} from '@iace/ui';
import { api } from '../lib/api';
import { framingOf } from '../routes/test-paper-view';
import { DispositionBadge, PaperDisposition } from './paper-disposition';
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

/** What the disposition menu needs beyond the row itself. Absent where nothing may be disposed. */
export interface PaperDispositionSpec {
  /** Every sitting on the test, for the confirm to name what it is about to move. */
  attemptCount: number;
  variantCount: number;
  onRescoring: () => void;
}

function paperColumns(
  stranded: Readonly<Record<string, PickRefusal>>,
  testId: string,
  disposition: PaperDispositionSpec | undefined,
  onChanged: (next: TestPaper) => Promise<void>,
): DataTableColumn<PaperRow>[] {
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
            <TruncatedText>{row.question.stemPreview}</TruncatedText>
          </QuestionLink>
          <span className="flex min-w-0 items-center gap-2">
            <TruncatedText className="text-xs text-muted-foreground">
              {[
                row.question.difficulty.toLowerCase(),
                row.question.questionCode,
                `${row.marks} marks`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </TruncatedText>
            {refusalOf(stranded, row.questionId)}
            <DispositionBadge status={row.status} />
          </span>
        </span>
      ),
    },
    ...(disposition
      ? [
          {
            key: 'actions',
            cell: (row: PaperRow) => (
              <PaperDisposition testId={testId} row={row} onChanged={onChanged} {...disposition} />
            ),
          },
        ]
      : []),
  ];
}

export function PaperQuestions({
  testId,
  section,
  rows,
  spec,
  editable,
  disposition,
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
  /** Absent on a draft and without TEST_MANAGEMENT write, which is when nothing may be disposed. */
  disposition?: PaperDispositionSpec;
  /** True while `rows` are last read's, so the table draws its shape instead of another paper's. */
  isLoading?: boolean;
  /** Beside the heading — filling the rest of this section. */
  action?: ReactNode;
  /** Above the rows — how the last fill was refused. */
  banner?: ReactNode;
  onChanged: (next: TestPaper) => Promise<void>;
}>) {
  // Ticked here and removed together, the way the bank is ticked and added together.
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const going = rows.filter((row) => picked.has(row.id));

  const stranded = strandedPicks(
    rows.map((row) => ({
      questionId: row.questionId,
      difficulty: row.question.difficulty,
      topicId: row.question.topicId,
    })),
    spec,
  );

  const remove = useMutation({
    meta: { success: 'Questions removed.' },
    mutationFn: (rowIds: readonly string[]) => api.admin.tests.removePaperQuestions(testId, rowIds),
    onSuccess: async (next) => {
      setConfirming(false);
      setPicked(new Set());
      await onChanged(next);
    },
  });

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <SectionHeading
        className="shrink-0"
        title="On the paper"
        meta={`${rows.length} of ${section.questionCount} · ${framingOf(section)}`}
        action={
          <span className="flex items-center gap-2">
            {editable && going.length > 0 ? (
              <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
                {`Remove ${going.length}`}
              </Button>
            ) : null}
            {action}
          </span>
        }
      />

      {banner}

      <DataTable
        columns={paperColumns(stranded, testId, disposition, onChanged)}
        rows={rows}
        rowKey={(row) => row.id}
        selection={
          editable ? { selected: picked, onChange: setPicked, label: 'Select question' } : undefined
        }
        isLoading={isLoading}
        empty="Nothing chosen for this section yet. Tick questions in the bank and add them."
      />

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        destructive
        title={`Remove ${plural(going.length, 'question')} from ${section.name}?`}
        description={`${section.name} drops to ${rows.length - going.length} of the ${section.questionCount} it needs, so this test cannot be offered until they are replaced.`}
        confirmLabel={`Remove ${plural(going.length, 'question')}`}
        loading={remove.isPending}
        onConfirm={() => remove.mutate(going.map((row) => row.id))}
      />
    </section>
  );
}
