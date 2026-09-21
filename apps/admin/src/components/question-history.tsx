import { useMemo } from 'react';
import { X } from 'lucide-react';
import {
  AUDIT_FEATURE,
  type QuestionSummary,
  type QuestionVersionSummary,
  type RowAction,
} from '@iace/contracts';
import { useQuery } from '@tanstack/react-query';
import { useListScreen } from '@iace/app-kit/browser';
import {
  Alert,
  Badge,
  BadgeList,
  Button,
  DataTable,
  ListView,
  SectionHeading,
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  TruncatedText,
  type DataTableColumn,
} from '@iace/ui';
import { api } from '../lib/api';
import { useAuth } from '../providers/auth';
import { ChangedCell } from '../lib/audit-format';
import { ACTION_BADGE_VARIANT, WHEN_FORMATTER } from '../lib/audit-vocabulary';
import { AUDIT_ACTION_LABELS, AUDIT_ACTOR_TYPE_LABELS, QUERY_KEYS } from '../lib/constants';

/** Wider than a nav drawer: a version beside its changes needs the room. */
const PANEL = 'w-[--modal-w-lg] gap-5';

const NOTHING = <span className="text-muted-foreground">—</span>;

/** Built outside the component: `cell` is a render prop, not a component declaration. */
function versionColumns(): DataTableColumn<QuestionVersionSummary>[] {
  return [
    { key: 'version', header: 'Version', cell: (row) => row.version },
    {
      key: 'written',
      header: 'Written',
      cell: (row) => WHEN_FORMATTER.format(new Date(row.createdAt)),
    },
    {
      key: 'who',
      header: 'Who',
      className: 'max-w-[12rem]',
      cell: (row) => (row.authorName ? <TruncatedText>{row.authorName}</TruncatedText> : NOTHING),
    },
    {
      key: 'papers',
      header: 'Papers',
      className: 'max-w-[14rem]',
      cell: (row) => <BadgeList items={row.pinnedBy} label={(title) => title} empty={NOTHING} />,
    },
  ];
}

function editColumns(): DataTableColumn<RowAction>[] {
  return [
    {
      key: 'when',
      header: 'When',
      cell: (row) => WHEN_FORMATTER.format(new Date(row.createdAt)),
    },
    {
      key: 'who',
      header: 'Who',
      className: 'max-w-[12rem]',
      cell: (row) => (
        <TruncatedText>{row.actorName ?? AUDIT_ACTOR_TYPE_LABELS[row.actorType]}</TruncatedText>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      cell: (row) => (
        <Badge variant={ACTION_BADGE_VARIANT[row.action]}>{AUDIT_ACTION_LABELS[row.action]}</Badge>
      ),
    },
    { key: 'changed', header: 'Changed', cell: (row) => <ChangedCell row={row} /> },
  ];
}

/** Mounted only while the sheet is open, so neither list fetches behind a closed panel. */
function History({ question }: Readonly<{ question: QuestionSummary }>) {
  const { identity } = useAuth();
  const isSuperAdmin = identity?.isSuperAdmin ?? false;
  const versions = useQuery({
    queryKey: [...QUERY_KEYS.QUESTIONS, question.id, 'versions'],
    queryFn: () => api.admin.questions.versions(question.id),
  });

  const edits = useListScreen({
    queryKey: [...QUERY_KEYS.AUDIT, 'question', question.id],
    filters: [],
    toQuery: () => ({ entityId: question.id, feature: [AUDIT_FEATURE.QUESTION] }),
    fetchPage: (params) => api.admin.audit.rowActions(params),
  });

  const versionCells = useMemo(() => versionColumns(), []);
  const editCells = useMemo(() => editColumns(), []);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">
      <Alert variant="info">
        <span>
          An edit rewrites the current version until a test students can reach pins it, so there are
          fewer versions than edits.
          {isSuperAdmin
            ? ''
            : ' The edits below are your own; a super admin sees everybody\u2019s.'}
        </span>
      </Alert>

      <section className="flex flex-col gap-3">
        <SectionHeading level={3} title="Versions" />
        <DataTable
          columns={versionCells}
          rows={versions.data ?? []}
          rowKey={(row) => row.id}
          isLoading={versions.isLoading}
          isError={versions.isError}
          onRetry={versions.refetch}
          skeletonRows={3}
          empty="No versions yet"
        />
      </section>

      <section className="flex flex-col gap-3 border-t border-border pt-6">
        <SectionHeading level={3} title="Edits" />
        <ListView
          list={edits}
          columns={editCells}
          rowKey={(row) => row.id}
          skeletonRows={5}
          empty="No edits recorded"
        />
      </section>
    </div>
  );
}

export function QuestionHistorySheet({
  question,
  open,
  onOpenChange,
}: Readonly<{
  question: QuestionSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" aria-describedby={undefined} className={PANEL}>
        <div className="flex shrink-0 items-baseline gap-3 border-b border-border pb-3">
          <SheetTitle>History</SheetTitle>
          <span className="min-w-0 flex-1 text-sm text-muted-foreground">
            <TruncatedText>{question.questionCode ?? question.stemPreview}</TruncatedText>
          </span>
          <SheetClose asChild>
            <Button variant="ghost" size="iconSm" aria-label="Close history">
              <X aria-hidden />
            </Button>
          </SheetClose>
        </div>

        <History question={question} />
      </SheetContent>
    </Sheet>
  );
}
