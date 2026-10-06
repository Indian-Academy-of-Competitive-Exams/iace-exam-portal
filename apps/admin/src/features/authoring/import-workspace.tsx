import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  QUESTION_VALIDATION_CODE,
  repeatedLineOf,
  type QuestionImportDraft,
  type QuestionImportPlan,
  type QuestionImportRow,
} from '@iace/contracts';
import { Alert, Badge, Tooltip, TooltipContent, TooltipTrigger, TruncatedText, cn } from '@iace/ui';
import { api } from '../../lib/api';
import { importDraftQueryKey, importDraftsQueryKey } from '../../lib/constants';
import { AuthoringWorkspace, type Held, type WorkspaceSource } from './authoring-workspace';
import { headerOfDraft, stateOfDraft, toDraft } from './question-scaffold';

/** What Import will do with a row, said the way the preview table says it. */
function OutcomeBadge({ row }: Readonly<{ row: QuestionImportRow }>) {
  if (row.action === 'create') return <Badge variant="success">Create</Badge>;
  if (row.action === 'duplicate') {
    const repeats = repeatedLineOf(row.duplicateOf);
    if (repeats !== null) return <Badge variant="warning">{`Same as row ${repeats}`}</Badge>;
    return <Badge variant="info">Already in the bank</Badge>;
  }
  if (row.action === 'left_out') return <Badge variant="neutral">Left out</Badge>;
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

/** Why the section will not take this row: it is about where the row is going, which its own editor cannot show. */
function SectionRefusal({ row }: Readonly<{ row: QuestionImportRow }>) {
  const refused = row.issues.find(
    (issue) => issue.code === QUESTION_VALIDATION_CODE.SUBJECT_OUTSIDE_SECTION,
  );
  if (!refused) return null;
  return (
    <div className="px-4 pt-3">
      <Alert variant="warning">{refused.message}</Alert>
    </div>
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
      <span className="text-sm font-semibold tabular-nums">{`Question ${index + 1} of ${total}`}</span>
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
  startAt,
  onPlan,
  actions,
}: Readonly<{
  plan: QuestionImportPlan;
  startAt: string | null;
  /** Every row judged again after a save, which is how a fixed row turns to Create. */
  onPlan: (plan: QuestionImportPlan) => void;
  actions: React.ReactNode;
}>) {
  const queryClient = useQueryClient();
  const { importLogId, rows } = plan;

  const source = useMemo((): WorkspaceSource => {
    const draftsKey = importDraftsQueryKey(importLogId);
    // Read once for the whole sheet, and again only after a save invalidates it.
    const drafts = {
      queryKey: draftsKey,
      staleTime: Infinity,
      queryFn: () => api.admin.imports.questionDrafts(importLogId),
    };

    return {
      cards: rows.map((row, index) => ({
        key: String(row.line),
        lead: <RowLead row={row} index={index} total={rows.length} />,
        notice: <SectionRefusal row={row} />,
        editable: row.action !== 'left_out',
      })),
      query: (line) => ({
        queryKey: importDraftQueryKey(importLogId, line),
        queryFn: async (): Promise<Held> => {
          const found = (await queryClient.fetchQuery(drafts)).find(
            (row) => String(row.line) === line,
          );
          if (!found) throw new Error('This question is not in the preview');
          return { header: headerOfDraft(found.draft), state: stateOfDraft(found.draft) };
        },
      }),
      save: async (line, held) => {
        const draft = toDraft(held.state, held.header);
        onPlan(await api.admin.imports.saveQuestionRow(importLogId, Number(line), draft));
        // Only this row moved, so the sheet is patched in place and no card reads it from the server again.
        queryClient.setQueryData(draftsKey, (sheet: QuestionImportDraft[] | undefined) =>
          sheet?.map((row) => (row.line === Number(line) ? { ...row, draft } : row)),
        );
        await queryClient.invalidateQueries({ queryKey: importDraftQueryKey(importLogId, line) });
      },
      subjectLocked: false,
      checkDuplicates: false,
    };
  }, [importLogId, rows, onPlan, queryClient]);

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
      {rows.map((row, index) => {
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
                {index + 1}
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
