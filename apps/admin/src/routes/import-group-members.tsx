import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, FileUp, Loader2, UserPlus } from 'lucide-react';
import {
  IMPORT_ACCEPTED_EXTENSIONS,
  GROUP_MEMBER_IMPORT_TEMPLATE_FILENAME,
  type GroupMemberImportPlan,
  type GroupMemberImportRow,
} from '@iace/contracts';
import { bannerMessage } from '@iace/app-kit';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableState,
  TableHead,
  TableHeader,
  TableRow,
  linkVariants,
} from '@iace/ui';
import { PageHeader } from '../components/app-shell';
import { api } from '../lib/api';
import { ROUTES } from '../lib/constants';
import { saveBlob } from '../lib/save-blob';

/**
 * Adding students to ONE group from a list of mobile numbers.
 *
 * The group comes from the URL rather than a column in the sheet: it is the
 * group the admin came from, so it cannot be mistyped, and one file cannot
 * scatter students across batches nobody looked at.
 *
 * Add only. Removing someone takes away their route to a test, which is a
 * single visible act on that student, not something a spreadsheet does quietly.
 */
/**
 * The three requests this screen makes, and the file they act on.
 *
 * Lifted out of the component because the component's job is layout — reading
 * the wiring and the markup as one thing is what made it hard to follow.
 */
function useMemberImport(groupId: string) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<GroupMemberImportPlan | null>(null);

  const preview = useMutation({
    mutationFn: (chosen: File) => api.admin.imports.previewGroupMembers(groupId, chosen),
    onSuccess: setPlan,
  });

  const commit = useMutation({
    mutationFn: (chosen: File) => api.admin.imports.commitGroupMembers(groupId, chosen),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'groups'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'students'] });
    },
  });

  const sample = useMutation({
    mutationFn: () => api.admin.imports.groupMemberTemplate(),
    onSuccess: (blob) => saveBlob(blob, GROUP_MEMBER_IMPORT_TEMPLATE_FILENAME),
  });

  /** Choosing a file previews it at once — that is why they chose it. */
  const choose = (chosen: File | undefined) => {
    if (!chosen) return;
    setFile(chosen);
    setPlan(null);
    commit.reset();
    preview.reset();
    preview.mutate(chosen);
  };

  return {
    file,
    plan,
    preview,
    commit,
    sample,
    choose,
    canCommit: file !== null && (plan?.summary.willAdd ?? 0) > 0,
  };
}

export function ImportGroupMembersPage() {
  const { id = '' } = useParams();
  const { file, plan, preview, commit, sample, choose, canCommit } = useMemberImport(id);

  return (
    <>
      <Button variant="ghost" size="sm" className="-ml-2 mb-3" asChild>
        <Link to={ROUTES.GROUPS}>
          <ArrowLeft aria-hidden />
          All groups
        </Link>
      </Button>

      <PageHeader
        title="Add students to a group"
        description="One column of mobile numbers. Everyone on the list joins this group — nobody is removed, and nobody is enrolled who is not already a student."
      />

      {plan ? (
        <Alert variant="info" className="mb-5">
          <span>
            Adding to{' '}
            <strong>
              {plan.group.branchName} / {plan.group.name}
            </strong>
          </span>
        </Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="order-2 p-4 lg:order-1">
          <ImportBanners
            groupId={id}
            fileErrors={plan?.fileErrors ?? []}
            added={commit.data?.added}
            error={preview.error ?? commit.error}
          />

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead numeric>Line</TableHead>
                <TableHead>Mobile</TableHead>
                <TableHead>Student</TableHead>
                <TableHead>What happens</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableState
                isLoading={false}
                isEmpty={plan === null || plan.rows.length === 0}
                colSpan={4}
                empty={
                  plan === null
                    ? 'Choose a file of mobile numbers to see exactly who would be added. Nothing changes until you press Add.'
                    : 'No rows in that file.'
                }
              >
                {plan?.rows.map((row) => (
                  <MemberRow key={row.line} row={row} />
                ))}
              </TableState>
            </TableBody>
          </Table>
        </Card>

        <div className="order-1 flex flex-col gap-4 lg:order-2">
          <Card>
            <CardHeader>
              <CardTitle>Start from the sample</CardTitle>
              <CardDescription>
                One column: Mobile Number. The group is not in the file — it is the one you came
                from.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Button variant="outline" disabled={sample.isPending} onClick={() => sample.mutate()}>
                {sample.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Download aria-hidden />
                )}
                Download sample file
              </Button>
              {sample.error ? <Alert variant="danger">{bannerMessage(sample.error)}</Alert> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Your list</CardTitle>
              <CardDescription>
                Excel (.xlsx). A .csv exported from another system works too.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground transition-colors hover:border-ring hover:text-foreground">
                <FileUp className="size-5" aria-hidden />
                <span className="font-medium text-foreground">
                  {file ? file.name : 'Choose a file'}
                </span>
                <span className="text-xs">
                  {file
                    ? `${(file.size / 1024).toFixed(0)} KB — choose another to replace it`
                    : IMPORT_ACCEPTED_EXTENSIONS.join(' or ')}
                </span>
                <input
                  type="file"
                  accept={IMPORT_ACCEPTED_EXTENSIONS.join(',')}
                  className="sr-only"
                  onChange={(event) => {
                    choose(event.target.files?.[0]);
                    // Cleared so choosing the SAME file again still fires: the
                    // admin has usually just fixed it and saved over the top.
                    event.target.value = '';
                  }}
                />
              </label>

              {preview.isPending ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Reading the file…
                </p>
              ) : null}

              <Button
                disabled={!canCommit || commit.isPending}
                onClick={() => file && commit.mutate(file)}
              >
                {commit.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <UserPlus aria-hidden />
                )}
                Add {plan ? `${plan.summary.willAdd} students` : 'students'}
              </Button>
            </CardContent>
          </Card>

          {plan ? (
            <Card>
              <CardHeader>
                <CardTitle>What this would do</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                <Summary label="Numbers read" value={plan.summary.total} />
                <Summary label="Will be added" value={plan.summary.willAdd} />
                <Summary label="Already in this group" value={plan.summary.alreadyMembers} />
                <Summary label="Skipped (have errors)" value={plan.summary.invalid} />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

/**
 * Everything this screen has to say above the preview table: what was wrong
 * with the file, what the import did, and what failed.
 *
 * Together in one place because they are one question — "did that work?" — and
 * four separate conditionals in the middle of the layout answered it in four
 * places nobody read as a set.
 */
function ImportBanners({
  groupId,
  fileErrors,
  added,
  error,
}: Readonly<{
  groupId: string;
  fileErrors: readonly string[];
  added: number | undefined;
  error: unknown;
}>) {
  return (
    <>
      {fileErrors.length > 0 && (
        <Alert variant="danger" className="mb-4">
          <span>{fileErrors.join(' ')}</span>
        </Alert>
      )}

      {added !== undefined && (
        <Alert variant="success" className="mb-4">
          <span>
            Added {added} student{added === 1 ? '' : 's'}.{' '}
            <Link
              to={`${ROUTES.STUDENTS}?groupId=${groupId}`}
              className={linkVariants({ variant: 'inline' })}
            >
              View the group
            </Link>
          </span>
        </Alert>
      )}

      {Boolean(error) && (
        <Alert variant="danger" className="mb-4">
          {bannerMessage(error)}
        </Alert>
      )}
    </>
  );
}

function Summary({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}

/** What one line does. Three outcomes, listed rather than chained. */
function MemberOutcome({ row }: Readonly<{ row: GroupMemberImportRow }>) {
  if (row.action === 'add') return <Badge variant="success">Add</Badge>;
  // Not an error: re-uploading a list with a few new numbers on the end is the
  // normal way this gets used.
  if (row.action === 'already') return <Badge variant="neutral">Already in this group</Badge>;

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge variant="danger">Skip</Badge>
      <span className="text-xs text-destructive">{row.errors.join('; ')}</span>
    </span>
  );
}

function MemberRow({ row }: Readonly<{ row: GroupMemberImportRow }>) {
  return (
    <TableRow>
      <TableCell numeric className="text-muted-foreground">
        {row.line}
      </TableCell>
      <TableCell className="tabular-nums">{row.mobile ?? '—'}</TableCell>
      <TableCell>{row.studentName ?? <span className="text-muted-foreground">—</span>}</TableCell>
      <TableCell>
        <MemberOutcome row={row} />
      </TableCell>
    </TableRow>
  );
}
