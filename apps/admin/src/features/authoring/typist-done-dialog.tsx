import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DIFFICULTY_LABELS,
  DIFFICULTY_LEVELS,
  sectionQuota,
  type Assignment,
  type SectionQuestion,
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
import { QUERY_KEYS, sectionWorkQueryKey } from '../../lib/constants';

/** A typist's Done: exactly the section's questions onto its paper, the rest to the bank or deleted. */
export function TypistDoneDialog({
  assignment,
  onClose,
}: Readonly<{ assignment: Assignment | null; onClose: () => void }>) {
  if (assignment === null) return null;
  return <DoneDialog key={assignment.id} assignment={assignment} onClose={onClose} />;
}

function DoneDialog({
  assignment,
  onClose,
}: Readonly<{ assignment: Assignment; onClose: () => void }>) {
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [discarded, setDiscarded] = useState<ReadonlySet<string>>(new Set());

  const { testId, baseConfigSectionId } = assignment;
  const work = useQuery({
    queryKey: sectionWorkQueryKey(testId, baseConfigSectionId),
    queryFn: () => api.admin.sectionWork.one(testId, baseConfigSectionId),
  });
  const questions = work.data?.questions ?? [];
  const rows = questions.filter((question) => question.typed);
  const leavingPaper = questions.filter((question) => question.order !== null && !question.typed);

  const gaps = selectionGaps(assignment, rows, chosen);
  const leftover = rows.filter((row) => !chosen.has(row.questionId));
  const deleting = leftover.filter((row) => discarded.has(row.questionId)).length;

  const done = useMutation({
    meta: { success: `${assignment.sectionName} marked done.` },
    mutationFn: () =>
      api.admin.sectionWork.done(testId, baseConfigSectionId, {
        selected: [...chosen],
        discard: leftover
          .filter((row) => discarded.has(row.questionId))
          .map((row) => row.questionId),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ASSIGNMENTS }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.AUTHORING }),
        // Exact: a card Done just detached or deleted would refetch into a "No such question" toast.
        queryClient.invalidateQueries({
          queryKey: sectionWorkQueryKey(testId, baseConfigSectionId),
          exact: true,
        }),
      ]);
      onClose();
    },
  });

  const toggleDiscard = useCallback(
    (id: string) => {
      const next = new Set(discarded);
      if (!next.delete(id)) next.add(id);
      setDiscarded(next);
    },
    [discarded],
  );
  const columns = useMemo(
    () => columnsOf(chosen, discarded, toggleDiscard),
    [chosen, discarded, toggleDiscard],
  );

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
            <Alert variant="info">{leftoverNotice(leftover.length, deleting)}</Alert>
          ) : null}

          {leavingPaper.length > 0 ? (
            <Alert variant="warning">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span>{leavingPaperNotice(leavingPaper.length)}</span>
                <ul className="flex list-disc flex-col gap-1 pl-4">
                  {leavingPaper.map((row) => (
                    <li key={row.questionId}>
                      <TruncatedText>{row.preview}</TruncatedText>
                    </li>
                  ))}
                </ul>
              </div>
            </Alert>
          ) : null}

          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.questionId}
            isLoading={work.isLoading}
            isError={work.isError}
            onRetry={() => void work.refetch()}
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
): DataTableColumn<SectionQuestion>[] {
  return [
    {
      key: 'stem',
      header: 'Question',
      className: 'max-w-sm',
      cell: (row) => <TruncatedText>{row.preview}</TruncatedText>,
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
        chosen.has(row.questionId) ? null : (
          <Checkbox
            aria-label={`Delete “${row.preview}” instead of keeping it in the bank`}
            checked={discarded.has(row.questionId)}
            onChange={() => toggleDiscard(row.questionId)}
          />
        ),
    },
  ];
}

function leftoverNotice(leftover: number, deleting: number): string {
  const banked = leftover - deleting;
  const kept = `${plural(banked, 'question')} not chosen ${banked === 1 ? 'goes' : 'go'} to the bank for any test to pick.`;
  return deleting > 0 ? `${kept} ${plural(deleting, 'question')} will be deleted.` : kept;
}

function leavingPaperNotice(count: number): string {
  const one = count === 1;
  return `${plural(count, 'question')} already on this section's paper ${one ? 'comes' : 'come'} off it at Done. ${one ? 'It stays' : 'They stay'} in the bank.`;
}

const chosenLevels = (rows: readonly SectionQuestion[], chosen: ReadonlySet<string>) =>
  rows.filter((row) => chosen.has(row.questionId)).map((row) => row.difficulty);

/** What stands between this choice and Done, in the words the server would refuse it with. */
function selectionGaps(
  assignment: Assignment,
  rows: readonly SectionQuestion[],
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
    const counts = off.map(
      (level) => `${DIFFICULTY_LABELS[level]} ${quota[level].chosen} of ${quota[level].allowed}`,
    );
    gaps.push(`The split is ${counts.join(', ')}.`);
  }
  return gaps;
}

function mixBadges(
  assignment: Assignment,
  rows: readonly SectionQuestion[],
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
