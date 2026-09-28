import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DIFFICULTY_LABELS,
  DIFFICULTY_LEVELS,
  sectionQuota,
  type AssignmentWithTest,
  type QuestionSummary,
} from '@iace/contracts';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  TruncatedText,
  plural,
  type DataTableColumn,
} from '@iace/ui';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';
import { sectionQuestions } from './section-questions';

/** A typist's Done: exactly the section's questions onto its paper, the rest to the bank or deleted. */
export function TypistDoneDialog({
  assignment,
  onClose,
}: Readonly<{ assignment: AssignmentWithTest | null; onClose: () => void }>) {
  if (assignment === null) return null;
  return <DoneDialog key={assignment.id} assignment={assignment} onClose={onClose} />;
}

function DoneDialog({
  assignment,
  onClose,
}: Readonly<{ assignment: AssignmentWithTest; onClose: () => void }>) {
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [discarded, setDiscarded] = useState<ReadonlySet<string>>(new Set());

  const written = useQuery({
    queryKey: [...QUERY_KEYS.AUTHORING, 'section', assignment.id, 'all'],
    queryFn: () => sectionQuestions(assignment.id),
  });
  const rows = written.data ?? [];

  const gaps = selectionGaps(assignment, rows, chosen);
  const leftover = rows.filter((row) => !chosen.has(row.id));
  const deleting = leftover.filter((row) => discarded.has(row.id)).length;

  const done = useMutation({
    meta: { success: `${assignment.sectionName} marked done.` },
    mutationFn: () =>
      api.admin.assignments.done(assignment.id, {
        selected: [...chosen],
        discard: leftover.filter((row) => discarded.has(row.id)).map((row) => row.id),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ASSIGNMENTS }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.AUTHORING }),
      ]);
      onClose();
    },
  });

  const toggleDiscard = (id: string) => {
    const next = new Set(discarded);
    if (!next.delete(id)) next.add(id);
    setDiscarded(next);
  };
  const columns = columnsOf(chosen, discarded, toggleDiscard);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{`Mark ${assignment.sectionName} done`}</DialogTitle>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Badge
              variant={chosen.size === assignment.sectionQuestionCount ? 'success' : 'warning'}
            >
              {`${chosen.size} of ${assignment.sectionQuestionCount} chosen`}
            </Badge>
            {mixBadges(assignment, rows, chosen)}
          </div>

          {gaps.length > 0 && rows.length > 0 ? (
            <Alert variant="warning">{gaps.join(' ')}</Alert>
          ) : null}

          {leftover.length > 0 && chosen.size > 0 ? (
            <Alert variant="info">
              {`${plural(leftover.length - deleting, 'question')} not chosen go to the bank for any test to pick.${deleting > 0 ? ` ${plural(deleting, 'question')} will be deleted.` : ''}`}
            </Alert>
          ) : null}

          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            isLoading={written.isLoading}
            isError={written.isError}
            onRetry={() => void written.refetch()}
            empty="Nothing written for this section yet"
            selection={{
              selected: chosen,
              onChange: setChosen,
              label: 'Choose every question shown',
            }}
            scroll={{}}
          />
        </DialogBody>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={gaps.length > 0}
            loading={done.isPending}
            onClick={() => done.mutate()}
          >
            Mark done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function columnsOf(
  chosen: ReadonlySet<string>,
  discarded: ReadonlySet<string>,
  toggleDiscard: (id: string) => void,
): DataTableColumn<QuestionSummary>[] {
  return [
    {
      key: 'stem',
      header: 'Question',
      className: 'max-w-sm',
      cell: (row) => <TruncatedText>{row.stemPreview}</TruncatedText>,
    },
    {
      key: 'difficulty',
      header: 'Difficulty',
      cell: (row) => <Badge variant="neutral">{DIFFICULTY_LABELS[row.difficulty]}</Badge>,
    },
    {
      key: 'discard',
      header: 'Delete',
      cell: (row) =>
        chosen.has(row.id) ? null : (
          <Checkbox
            aria-label={`Delete “${row.stemPreview}” instead of keeping it in the bank`}
            checked={discarded.has(row.id)}
            onChange={() => toggleDiscard(row.id)}
          />
        ),
    },
  ];
}

const chosenLevels = (rows: readonly QuestionSummary[], chosen: ReadonlySet<string>) =>
  rows.filter((row) => chosen.has(row.id)).map((row) => row.difficulty);

/** What stands between this choice and Done, in the words the server would refuse it with. */
function selectionGaps(
  assignment: AssignmentWithTest,
  rows: readonly QuestionSummary[],
  chosen: ReadonlySet<string>,
): string[] {
  const needed = assignment.sectionQuestionCount;
  if (rows.length < needed) {
    return [`Write ${needed - rows.length} more before this section can be marked done.`];
  }
  const gaps = chosen.size === needed ? [] : [`Choose exactly ${needed}.`];
  const quota = sectionQuota(assignment.sectionMix ?? undefined, chosenLevels(rows, chosen));
  const off = DIFFICULTY_LEVELS.filter(
    (level) => quota[level].allowed !== null && quota[level].chosen !== quota[level].allowed,
  );
  if (off.length > 0 && chosen.size === needed) {
    gaps.push(
      `The split is ${off.map((level) => `${DIFFICULTY_LABELS[level]} ${quota[level].chosen} of ${quota[level].allowed}`).join(', ')}.`,
    );
  }
  return gaps;
}

function mixBadges(
  assignment: AssignmentWithTest,
  rows: readonly QuestionSummary[],
  chosen: ReadonlySet<string>,
) {
  if (!assignment.sectionMix) return null;
  const quota = sectionQuota(assignment.sectionMix, chosenLevels(rows, chosen));
  return DIFFICULTY_LEVELS.filter((level) => quota[level].allowed !== null).map((level) => (
    <Badge
      key={level}
      variant={quota[level].chosen === quota[level].allowed ? 'success' : 'neutral'}
    >
      {`${DIFFICULTY_LABELS[level]} ${quota[level].chosen}/${quota[level].allowed}`}
    </Badge>
  ));
}
