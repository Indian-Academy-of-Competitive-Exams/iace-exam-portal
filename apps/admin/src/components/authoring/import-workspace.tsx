import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { type QuestionImportPlan, type QuestionImportRow } from '@iace/contracts';
import { Badge, Tooltip, TooltipContent, TooltipTrigger, TruncatedText, cn } from '@iace/ui';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';
import { AuthoringWorkspace, type Held, type WorkspaceSource } from './authoring-workspace';
import { headerOfDraft, stateOfDraft, toDraft } from './question-scaffold';

/** What Import will do with a row, said the way the preview table says it. */
function OutcomeBadge({ row }: Readonly<{ row: QuestionImportRow }>) {
  if (row.action === 'create') return <Badge variant="success">Create</Badge>;
  if (row.action === 'duplicate') return <Badge variant="info">Already in the bank</Badge>;
  return <Badge variant="danger">Skip</Badge>;
}

/** The same, with why a skipped row is skipped. */
function Outcome({ row }: Readonly<{ row: QuestionImportRow }>) {
  if (row.action !== 'skip') return <OutcomeBadge row={row} />;
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

const pictures = (count: number) => `${count} blurry ${count === 1 ? 'picture' : 'pictures'}`;

function RowLead({
  row,
  index,
  total,
}: Readonly<{ row: QuestionImportRow; index: number; total: number }>) {
  return (
    <>
      <span className="text-sm font-semibold tabular-nums">{`Line ${row.line}`}</span>
      <span className="text-xs tabular-nums text-muted-foreground">{`${index + 1} of ${total}`}</span>
      <Outcome row={row} />
      {row.warnings.length > 0 ? (
        <Badge variant="warning">{pictures(row.warnings.length)}</Badge>
      ) : null}
      {row.edited ? <Badge variant="neutral">Edited</Badge> : null}
    </>
  );
}

/** Every row of the sheet, corrected on the authoring page before Import; nothing reaches the bank until then. */
export function ImportWorkspace({
  plan,
  into,
  startAt,
  onPlan,
  actions,
}: Readonly<{
  plan: QuestionImportPlan;
  /** The section a typist's import lands in; null for the bank. */
  into: string | null;
  startAt: string | null;
  /** Every row judged again after a save, which is how a fixed row turns to Create. */
  onPlan: (plan: QuestionImportPlan) => void;
  actions: React.ReactNode;
}>) {
  const queryClient = useQueryClient();
  const { importLogId, rows } = plan;

  const source = useMemo((): WorkspaceSource => {
    const draftsKey = [...QUERY_KEYS.QUESTIONS, 'import', importLogId] as const;
    // Read once for the whole sheet, and again only after a save invalidates it.
    const drafts = {
      queryKey: draftsKey,
      staleTime: Infinity,
      queryFn: () =>
        into
          ? api.admin.authoring.importDrafts(into, importLogId)
          : api.admin.imports.questionDrafts(importLogId),
    };

    return {
      cards: rows.map((row, index) => ({
        key: String(row.line),
        lead: <RowLead row={row} index={index} total={rows.length} />,
        editable: true,
      })),
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
      save: async (line, held) => {
        const draft = toDraft(held.state, held.header);
        const judged = into
          ? await api.admin.authoring.saveImportRow(into, importLogId, Number(line), draft)
          : await api.admin.imports.saveQuestionRow(importLogId, Number(line), draft);
        onPlan(judged);
        await queryClient.invalidateQueries({ queryKey: draftsKey });
      },
      subjectLocked: false,
      checkDuplicates: false,
    };
  }, [importLogId, rows, into, onPlan, queryClient]);

  return (
    <AuthoringWorkspace
      source={source}
      startAt={startAt}
      saveLabel="Save and next"
      extraActions={actions}
      panel={{
        label: 'Imported questions',
        render: (position) => <ImportedRows rows={rows} {...position} />,
      }}
    />
  );
}

function ImportedRows({
  rows,
  activeKey,
  jump,
}: Readonly<{
  rows: readonly QuestionImportRow[];
  activeKey: string;
  jump: (key: string) => void;
}>) {
  return (
    <ol className="flex flex-col gap-1">
      {rows.map((row) => {
        const key = String(row.line);
        return (
          <li key={key}>
            <button
              type="button"
              aria-current={key === activeKey ? 'true' : undefined}
              onClick={() => jump(key)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
                'focus-visible:shadow-focus focus-visible:outline-none',
                key === activeKey && 'bg-muted',
              )}
            >
              <span className="w-8 flex-none text-xs tabular-nums text-muted-foreground">
                {row.line}
              </span>
              <TruncatedText className="min-w-0 flex-1">{row.stemPreview || '—'}</TruncatedText>
              <OutcomeBadge row={row} />
            </button>
          </li>
        );
      })}
    </ol>
  );
}
