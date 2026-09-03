import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Download, RefreshCw, Upload } from 'lucide-react';
import {
  IMPORT_ACCEPTED_EXTENSIONS,
  STUDENT_IMPORT_TEMPLATE_FILENAME,
  XLSX_CONTENT_TYPE,
  type StudentImportPlan,
  type StudentImportRow,
} from '@iace/contracts';
import {
  Alert,
  Badge,
  BadgeList,
  Button,
  Card,
  FileDropzone,
  linkVariants,
  LoadingState,
  FormSection,
  PageFrame,
  PageHeader,
  StatRow,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableState,
  TruncatedText,
} from '@iace/ui';
import { PageCrumbs } from '@iace/app-kit/browser';
import { useAuth } from '../providers/auth';
import { api } from '../lib/api';
import { NAV_ITEMS, ROUTES } from '../lib/constants';
import { saveBlob } from '../lib/save-blob';

/** Which roster the plan on screen came from, so Import applies the one that was previewed. */
type ImportSourceChoice = 'file' | 'portal';

/** Preview, then commit — from a file or from the portal. Three bad rows still import the other 397. */
export function ImportStudentsPage() {
  const { identity: admin } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<StudentImportPlan | null>(null);
  const [source, setSource] = useState<ImportSourceChoice>('file');

  const preview = useMutation({
    mutationFn: (chosen: File) => api.admin.imports.previewStudents(chosen),
    onSuccess: setPlan,
  });

  const portalPreview = useMutation({
    mutationFn: () => api.admin.imports.previewPortalStudents(),
    onSuccess: setPlan,
  });

  const commit = useMutation({
    meta: {
      success: (data: unknown): string => {
        const result = data as { created: number; updated: number; skipped: number };
        return `Imported: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped.`;
      },
    },
    mutationFn: (chosen: File | null) =>
      chosen === null
        ? api.admin.imports.commitPortalStudents()
        : api.admin.imports.commitStudents(chosen),
  });

  const sample = useMutation({
    mutationFn: () => api.admin.imports.studentTemplate(),
    onSuccess: (blob) => saveBlob(blob, STUDENT_IMPORT_TEMPLATE_FILENAME),
  });

  /** Choosing a file previews it at once — that is why they chose it. */
  const choose = (chosen: File | undefined) => {
    if (!chosen) return;
    setSource('file');
    setFile(chosen);
    setPlan(null);
    commit.reset();
    portalPreview.reset();
    preview.reset();
    preview.mutate(chosen);
  };

  /** The portal replaces whatever file was staged: two rosters on one screen is two answers. */
  const pullFromPortal = () => {
    setSource('portal');
    setFile(null);
    setPlan(null);
    commit.reset();
    preview.reset();
    portalPreview.mutate();
  };

  const staged = source === 'portal' || file !== null;
  const canCommit =
    staged && plan !== null && plan.summary.willCreate + plan.summary.willUpdate > 0;

  return (
    <PageFrame
      // Below lg the two columns stack, so the page scrolls; side by side they scroll separately.
      className="lg:overflow-hidden"
      header={<PageHeader breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />} title="Import students" />}
    >
      <div className="grid gap-5 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="relative order-2 p-4 lg:order-1 lg:min-h-0 lg:overflow-y-auto">
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
                <Link to={ROUTES.STUDENTS} className={linkVariants({ variant: 'inline' })}>
                  View students
                </Link>
              </span>
            </Alert>
          ) : null}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead numeric>Line</TableHead>
                <TableHead>Mobile</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Reaches</TableHead>
                <TableHead>What happens</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableState
                isLoading={false}
                isEmpty={plan === null || plan.rows.length === 0}
                colSpan={5}
                empty={
                  plan === null
                    ? 'Choose a file, or pull from the portal, to see exactly what it would do. Nothing is written until you press Import.'
                    : 'No rows in that file.'
                }
              >
                {plan?.rows.map((row) => (
                  <ImportRow key={row.line} row={row} />
                ))}
              </TableState>
            </TableBody>
          </Table>
        </Card>

        <Card className="relative order-1 flex flex-col gap-6 p-4 lg:order-2 lg:min-h-0 lg:overflow-y-auto">
          {/* The sample comes first: the shape of the file matters before anywhere to put one. */}
          <FormSection title="Start from the sample">
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                icon={<Download aria-hidden />}
                loading={sample.isPending}
                onClick={() => sample.mutate()}
              >
                Download sample file
              </Button>
            </div>
          </FormSection>

          {/* Super admin only, as the old trigger was: it pulls a whole roster from a system
              this screen does not control. */}
          {admin?.isSuperAdmin ? (
            <FormSection title="From the main portal">
              <div className="flex flex-col gap-3">
                <Button
                  variant="outline"
                  icon={<RefreshCw aria-hidden />}
                  loading={portalPreview.isPending}
                  onClick={pullFromPortal}
                >
                  Sync from portal
                </Button>

                {portalPreview.isPending ? <LoadingState>Reading the portal…</LoadingState> : null}
              </div>
            </FormSection>
          ) : null}

          <FormSection title="Your file">
            <div className="flex flex-col gap-3">
              <FileDropzone
                accept={`${IMPORT_ACCEPTED_EXTENSIONS.join(',')},${XLSX_CONTENT_TYPE}`}
                file={file}
                onFileChange={choose}
                /* ui-copy-ok: format */ hint={IMPORT_ACCEPTED_EXTENSIONS.join(' or ')}
                aria-label="Student import file"
              />

              {preview.isPending ? <LoadingState>Reading the file…</LoadingState> : null}

              <Button
                icon={<Upload aria-hidden />}
                loading={commit.isPending}
                disabled={!canCommit}
                onClick={() => commit.mutate(file)}
              >
                Import {plan ? `${plan.summary.willCreate + plan.summary.willUpdate} rows` : ''}
              </Button>
            </div>
          </FormSection>

          {plan ? (
            <FormSection title="Preview">
              <div className="flex flex-col gap-2 text-sm">
                <StatRow label="Rows read" value={plan.summary.total} />
                <StatRow label="New students" value={plan.summary.willCreate} />
                <StatRow label="Existing students updated" value={plan.summary.willUpdate} />
                <StatRow label="Skipped (have errors)" value={plan.summary.invalid} />
                <StatRow
                  label="Given a starting PIN"
                  value={plan.rows.filter((row) => row.willReceiveDefaultPin).length}
                />
              </div>
            </FormSection>
          ) : null}
        </Card>
      </div>
    </PageFrame>
  );
}

function ImportRow({ row }: Readonly<{ row: StudentImportRow }>) {
  return (
    <TableRow>
      <TableCell numeric className="text-muted-foreground">
        {row.line}
      </TableCell>
      <TableCell className="tabular-nums">{row.mobile ?? '—'}</TableCell>
      <TableCell>
        <TruncatedText className="max-w-[12rem]">{row.fullName}</TruncatedText>
      </TableCell>
      <TableCell>
        <TruncatedText className="max-w-[10rem]">{row.branchName}</TruncatedText>
      </TableCell>
      <TableCell>
        {/* What actually opens a series for them, so it is checked before the commit. */}
        <BadgeList
          items={[...row.enrolledCourses, ...row.enrolledExams, ...row.programs]}
          label={(code) => code}
          max={2}
          empty={<span className="text-muted-foreground">Nothing</span>}
        />
      </TableCell>
      <TableCell>
        {row.action !== 'skip' ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge variant={row.action === 'create' ? 'success' : 'info'}>
              {row.action === 'create' ? 'Create' : 'Update'}
            </Badge>
            {row.willReceiveDefaultPin ? <Badge variant="neutral">+ starting PIN</Badge> : null}
          </span>
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
