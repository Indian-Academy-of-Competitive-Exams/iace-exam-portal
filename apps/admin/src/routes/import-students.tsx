import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, FileUp, Loader2, Upload } from 'lucide-react';
import {
  STUDENT_IMPORT_TEMPLATE,
  type StudentImportPlan,
  type StudentImportRow,
} from '@iace/contracts';
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
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@iace/ui';
import { PageHeader } from '../components/app-shell';
import { api } from '../lib/api';
import { ROUTES } from '../lib/constants';
import { bannerMessage } from '../lib/form-errors';

/**
 * Preview, then commit. Nothing is written until the admin has seen exactly
 * what would happen — and a file with three bad rows still imports the other
 * 397 rather than being refused whole.
 */
export function ImportStudentsPage() {
  const [csv, setCsv] = useState('');
  const [plan, setPlan] = useState<StudentImportPlan | null>(null);

  const preview = useMutation({
    mutationFn: () => api.admin.imports.previewStudents({ csv }),
    onSuccess: setPlan,
  });

  const commit = useMutation({
    mutationFn: () => api.admin.imports.commitStudents({ csv }),
  });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setPlan(null);
    commit.reset();
    setCsv(await file.text());
  };

  const canCommit = plan !== null && plan.summary.willCreate + plan.summary.willUpdate > 0;

  return (
    <>
      <Button variant="ghost" size="sm" className="mb-3 -ml-2" asChild>
        <Link to={ROUTES.STUDENTS}>
          <ArrowLeft aria-hidden />
          All students
        </Link>
      </Button>

      <PageHeader
        title="Import students"
        description="A mobile column is required; fullName and groups are optional. Groups must already exist — a name that does not match is reported rather than created."
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="order-2 p-4 lg:order-1">
          {plan?.fileErrors.length ? (
            <Alert variant="danger" className="mb-4">
              <span>{plan.fileErrors.join(' ')}</span>
            </Alert>
          ) : null}

          {commit.data ? (
            <Alert variant="success" className="mb-4">
              <span>
                Imported: {commit.data.created} created, {commit.data.updated} updated,{' '}
                {commit.data.skipped} skipped.{' '}
                <Link to={ROUTES.STUDENTS} className="underline underline-offset-4">
                  View students
                </Link>
              </span>
            </Alert>
          ) : null}

          {preview.error ? (
            <Alert variant="danger" className="mb-4">
              {bannerMessage(preview.error)}
            </Alert>
          ) : null}
          {commit.error ? (
            <Alert variant="danger" className="mb-4">
              {bannerMessage(commit.error)}
            </Alert>
          ) : null}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead numeric>Line</TableHead>
                <TableHead>Mobile</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Groups</TableHead>
                <TableHead>What happens</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plan === null ? (
                <TableEmpty colSpan={5}>
                  Paste a file or choose one, then preview it. Nothing is written until you commit.
                </TableEmpty>
              ) : plan.rows.length === 0 ? (
                <TableEmpty colSpan={5}>No rows in that file.</TableEmpty>
              ) : (
                plan.rows.map((row) => <ImportRow key={row.line} row={row} />)
              )}
            </TableBody>
          </Table>
        </Card>

        <div className="order-1 flex flex-col gap-4 lg:order-2">
          <Card>
            <CardHeader>
              <CardTitle>The file</CardTitle>
              <CardDescription>Upload a CSV, or paste its contents.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground transition-colors hover:border-ring hover:text-foreground">
                <FileUp className="size-4" aria-hidden />
                Choose a CSV file
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  onChange={(event) => void onFile(event.target.files?.[0])}
                />
              </label>

              <Textarea
                aria-label="CSV contents"
                rows={8}
                className="font-mono text-xs"
                placeholder={STUDENT_IMPORT_TEMPLATE}
                value={csv}
                onChange={(event) => {
                  setCsv(event.target.value);
                  setPlan(null);
                  commit.reset();
                }}
              />

              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  variant="secondary"
                  disabled={csv.trim() === '' || preview.isPending}
                  onClick={() => {
                    commit.reset();
                    preview.mutate();
                  }}
                >
                  {preview.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                  Preview
                </Button>
                <Button
                  className="flex-1"
                  disabled={!canCommit || commit.isPending}
                  onClick={() => commit.mutate()}
                >
                  {commit.isPending ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Upload aria-hidden />
                  )}
                  Import
                </Button>
              </div>
            </CardContent>
          </Card>

          {plan ? (
            <Card>
              <CardHeader>
                <CardTitle>What this would do</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                <Summary label="Rows read" value={plan.summary.total} />
                <Summary label="New students" value={plan.summary.willCreate} />
                <Summary label="Existing students updated" value={plan.summary.willUpdate} />
                <Summary label="Skipped (have errors)" value={plan.summary.invalid} />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function ImportRow({ row }: { row: StudentImportRow }) {
  return (
    <TableRow>
      <TableCell numeric className="text-muted-foreground">
        {row.line}
      </TableCell>
      <TableCell className="tabular-nums">{row.mobile ?? '—'}</TableCell>
      <TableCell>{row.fullName ?? <span className="text-muted-foreground">—</span>}</TableCell>
      <TableCell className="text-muted-foreground">
        {row.groupNames.length ? row.groupNames.join(', ') : '—'}
      </TableCell>
      <TableCell>
        {row.action === 'create' ? (
          <Badge variant="success">Create</Badge>
        ) : row.action === 'update' ? (
          <Badge variant="info">Update</Badge>
        ) : (
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge variant="danger">Skip</Badge>
            <span className="text-xs text-destructive">{row.errors.join('; ')}</span>
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}
