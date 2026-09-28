import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { type QuestionImportPlan, type QuestionImportRow } from '@iace/contracts';
import { Badge, Tooltip, TooltipContent, TooltipTrigger } from '@iace/ui';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';
import { QuestionsWindow, type Held, type QuestionsSource } from './questions-window';
import { headerOfDraft, stateOfDraft, toDraft } from './question-scaffold';

/** What Import will do with the row in view, said the way the preview table says it. */
function Outcome({ row }: Readonly<{ row: QuestionImportRow }>) {
  if (row.action === 'create') return <Badge variant="success">Create</Badge>;
  if (row.action === 'duplicate') return <Badge variant="info">Already in the bank</Badge>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="rounded-full focus-visible:shadow-focus focus-visible:outline-none"
        >
          <Badge variant="danger">Skip</Badge>
        </button>
      </TooltipTrigger>
      <TooltipContent>{row.issues.map((issue) => issue.message).join('; ')}</TooltipContent>
    </Tooltip>
  );
}

/** Where the row in view stands: its line, its place, and what Import will do with it. */
function importLead(rows: readonly QuestionImportRow[], index: number) {
  const row = rows[index];
  if (!row) return null;
  return (
    <>
      <span className="text-sm font-semibold tabular-nums">{`Line ${row.line}`}</span>
      <span className="text-xs tabular-nums text-muted-foreground">
        {`${index + 1} of ${rows.length}`}
      </span>
      <Outcome row={row} />
      {row.warnings.length > 0 ? (
        <Badge variant="warning">
          {`${row.warnings.length} blurry ${row.warnings.length === 1 ? 'picture' : 'pictures'}`}
        </Badge>
      ) : null}
      {row.edited ? <Badge variant="neutral">Edited</Badge> : null}
    </>
  );
}

/** A previewed sheet in the scrolling window: each row corrected before Import, nothing written to the bank. */
export function ImportQuestionsWindow({
  plan,
  into,
  open,
  onOpenChange,
  startAt,
  onPlan,
}: Readonly<{
  plan: QuestionImportPlan;
  /** The section a typist's import lands in; null for the bank. */
  into: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startAt: string | null;
  /** Every row judged again after a save, which is how a fixed row turns to Create. */
  onPlan: (plan: QuestionImportPlan) => void;
}>) {
  const queryClient = useQueryClient();

  const source = useMemo((): QuestionsSource => {
    const { importLogId, rows } = plan;
    const draftsKey = [...QUERY_KEYS.QUESTIONS, 'import', importLogId] as const;
    // Read once for the whole window, and again only after a save invalidates it.
    const drafts = {
      queryKey: draftsKey,
      staleTime: Infinity,
      queryFn: () =>
        into
          ? api.admin.authoring.importDrafts(into, importLogId)
          : api.admin.imports.questionDrafts(importLogId),
    };

    return {
      title: 'Imported questions',
      keys: rows.map((row) => String(row.line)),
      query: (line) => ({
        queryKey: [...draftsKey, line],
        queryFn: async (): Promise<Held> => {
          const found = (await queryClient.fetchQuery(drafts)).find(
            (row) => String(row.line) === line,
          );
          if (!found) throw new Error(`Line ${line} is not in this preview`);
          return { header: headerOfDraft(found.draft), state: stateOfDraft(found.draft) };
        },
      }),
      lead: (index) => importLead(rows, index),
      subjectLocked: false,
      checkDuplicates: false,
      save: async (line, held) => {
        const draft = toDraft(held.state, held.header);
        const judged = into
          ? await api.admin.authoring.saveImportRow(into, importLogId, Number(line), draft)
          : await api.admin.imports.saveQuestionRow(importLogId, Number(line), draft);
        onPlan(judged);
        await queryClient.invalidateQueries({ queryKey: draftsKey });
      },
    };
  }, [plan, into, onPlan, queryClient]);

  return (
    <QuestionsWindow source={source} open={open} onOpenChange={onOpenChange} startAt={startAt} />
  );
}
