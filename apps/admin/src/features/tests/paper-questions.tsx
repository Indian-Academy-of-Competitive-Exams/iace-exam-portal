import { useMemo, useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  PICK_REFUSAL,
  sectionQuota,
  strandedPicks,
  type BaseConfigSection,
  type PaperRow,
  type PaperSource,
  type PickRefusal,
  type SectionDrawSpec,
  type TestPaper,
} from '@iace/contracts';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenuItem,
  RowActions,
  SectionHeading,
  TruncatedText,
  plural,
  type DataTableColumn,
} from '@iace/ui';
import { api } from '../../lib/api';
import { framingOf } from './test-paper-view';
import { DispositionBadge, PaperDisposition } from './paper-disposition';
import { QuestionLink } from '../../components/question-link';
import { QuestionChooser, type QuestionPicks } from './question-picker';

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
  onRescoring: () => void;
}

function paperColumns(
  stranded: Readonly<Record<string, PickRefusal>>,
  testId: string,
  disposition: PaperDispositionSpec | undefined,
  onChanged: (next: TestPaper) => Promise<void>,
  onReplace: ((row: PaperRow) => void) | undefined,
): DataTableColumn<PaperRow>[] {
  const rowActions = (row: PaperRow): ReactNode => {
    if (disposition) {
      return <PaperDisposition testId={testId} row={row} onChanged={onChanged} {...disposition} />;
    }
    return onReplace ? (
      <RowActions label={`Question ${row.order} actions`}>
        <DropdownMenuItem onSelect={() => onReplace(row)}>Replace</DropdownMenuItem>
      </RowActions>
    ) : null;
  };

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
    ...(disposition || onReplace ? [{ key: 'actions', cell: rowActions }] : []),
  ];
}

export function PaperQuestions({
  testId,
  section,
  rows,
  spec,
  editable,
  disposition,
  onReplace,
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
  /** Absent once the paper is frozen or its section is not the owner's to change. */
  onReplace?: (row: PaperRow) => void;
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

  const stranded = useMemo(
    () =>
      strandedPicks(
        rows.map((row) => ({
          questionId: row.questionId,
          difficulty: row.question.difficulty,
          topicId: row.question.topicId,
        })),
        spec,
      ),
    [rows, spec],
  );

  const columns = useMemo(
    () => paperColumns(stranded, testId, disposition, onChanged, onReplace),
    [stranded, testId, disposition, onChanged, onReplace],
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
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        selection={
          editable ? { selected: picked, onChange: setPicked, label: 'Select question' } : undefined
        }
        isLoading={false}
        empty={{
          title: 'Nothing chosen for this section yet',
          hint: 'Tick questions in the bank and add them.',
        }}
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

const NO_PICKS: QuestionPicks = new Map();

/** The bank again, for the one slot the row leaves: its difficulty and the split are judged as if it were empty. */
export function ReplaceQuestionDialog({
  testId,
  paperSource,
  section,
  spec,
  rows,
  row,
  held,
  onClose,
  onChanged,
}: Readonly<{
  testId: string;
  paperSource: PaperSource | null;
  section: BaseConfigSection;
  spec: SectionDrawSpec;
  /** The section's own rows, the one being replaced among them. */
  rows: readonly PaperRow[];
  row: PaperRow;
  /** Every question the whole paper holds, since one sits on it once wherever it was put. */
  held: ReadonlySet<string>;
  onClose: () => void;
  onChanged: (next: TestPaper) => Promise<void>;
}>) {
  const [picked, setPicked] = useState<QuestionPicks>(NO_PICKS);
  const [replacement] = picked.keys();
  const quota = useMemo(
    () =>
      sectionQuota(
        spec.mix,
        rows.filter((other) => other.id !== row.id).map((other) => other.question.difficulty),
      ),
    [spec.mix, rows, row.id],
  );

  const replace = useMutation({
    meta: { success: 'Question replaced.' },
    mutationFn: (questionId: string) =>
      api.admin.tests.replacePaperQuestion(testId, row.id, { questionId }),
    onSuccess: async (next) => {
      await onChanged(next);
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && !replace.isPending && onClose()}>
      <DialogContent size="window">
        <DialogHeader>
          <DialogTitle>{`Replace question ${row.order} in ${section.name}`}</DialogTitle>
        </DialogHeader>
        {/* The list is the one scroller here, so the body does not scroll as well. */}
        <DialogBody className="flex flex-col overflow-hidden">
          <QuestionChooser
            testId={testId}
            paperSource={paperSource}
            // One slot, the row's own, whatever the section still lacks.
            section={{ ...section, questionCount: rows.length }}
            spec={spec}
            quota={quota}
            held={held}
            picking={{ picked, onPicked: setPicked }}
          />
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary" disabled={replace.isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={replacement === undefined}
            loading={replace.isPending}
            onClick={() => replacement !== undefined && replace.mutate(replacement)}
          >
            Replace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
