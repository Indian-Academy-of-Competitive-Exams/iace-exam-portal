import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import {
  IMPORT_ACCEPTED_EXTENSIONS,
  STUDENT_IMPORT_TEMPLATE_FILENAME,
  XLSX_CONTENT_TYPE,
  type StudentImportRow,
} from '@iace/contracts';
import {
  Badge,
  BadgeList,
  Button,
  FormSection,
  ImportView,
  LoadingState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableState,
  TruncatedText,
  linkVariants,
} from '@iace/ui';
import { PageCrumbs, useImportScreen } from '@iace/app-kit/browser';
import { useAuth } from '../providers/auth';
import { api } from '../lib/api';
import { NAV_ITEMS, ROUTES } from '../lib/constants';
import { saveBlob } from '../lib/save-blob';

/** Preview, then commit — from a file or from the portal. Three bad rows still import the other 397. */
export function ImportStudentsPage() {
  const { identity: admin } = useAuth();

  const template = useMutation({
    mutationFn: () => api.admin.imports.studentTemplate(),
    onSuccess: (blob) => saveBlob(blob, STUDENT_IMPORT_TEMPLATE_FILENAME),
  });

  const intake = useImportScreen({
    preview: (file) => api.admin.imports.previewStudents(file),
    commit: (file) =>
      file === null
        ? api.admin.imports.commitPortalStudents()
        : api.admin.imports.commitStudents(file),
    writes: (plan) => plan.summary.willCreate + plan.summary.willUpdate,
    success: (data) => {
      const result = data as { created: number; updated: number; skipped: number };
      return `Imported: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped.`;
    },
  });

  const portal = useMutation({
    mutationFn: () => api.admin.imports.previewPortalStudents(),
    onSuccess: (plan) => intake.stage(null, plan),
  });

  /** The portal replaces whatever file was staged: two rosters on one screen is two answers. */
  const pullFromPortal = () => {
    intake.stage(null);
    portal.mutate();
  };

  const plan = intake.plan;

  return (
    <ImportView
      header={<PageHeader breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />} title="Import students" />}
      onDownloadTemplate={() => template.mutate()}
      downloadingTemplate={template.isPending}
      otherSource={
        // Super admin only: it pulls a whole roster from a system this screen does not control.
        admin?.isSuperAdmin ? (
          <FormSection title="From the main portal">
            <div className="flex flex-col gap-3">
              <Button
                variant="outline"
                icon={<RefreshCw aria-hidden />}
                loading={portal.isPending}
                onClick={pullFromPortal}
              >
                Sync from portal
              </Button>

              {portal.isPending ? <LoadingState>Reading the portal…</LoadingState> : null}
            </div>
          </FormSection>
        ) : null
      }
      dropzone={{
        accept: `${IMPORT_ACCEPTED_EXTENSIONS.join(',')},${XLSX_CONTENT_TYPE}`,
        file: intake.file,
        onFileChange: intake.choose,
        /* ui-copy-ok: format */ hint: IMPORT_ACCEPTED_EXTENSIONS.join(' or '),
        'aria-label': 'Student import file',
      }}
      previewing={intake.isPreviewing}
      action={{
        label: plan ? `Import ${intake.writes} rows` : 'Import',
        loading: intake.isCommitting,
        disabled: !intake.canCommit,
        onClick: intake.commit,
      }}
      fileErrors={plan?.fileErrors}
      outcome={
        intake.result ? (
          <>
            Imported: {intake.result.created} created, {intake.result.updated} updated,{' '}
            {intake.result.skipped} skipped.{' '}
            <Link to={ROUTES.STUDENTS} className={linkVariants({ variant: 'inline' })}>
              View students
            </Link>
          </>
        ) : null
      }
      stats={
        plan
          ? [
              { label: 'Rows read', value: plan.summary.total },
              { label: 'New students', value: plan.summary.willCreate },
              { label: 'Existing students updated', value: plan.summary.willUpdate },
              { label: 'Skipped (have errors)', value: plan.summary.invalid },
              {
                label: 'Given a starting PIN',
                value: plan.rows.filter((row) => row.willReceiveDefaultPin).length,
              },
            ]
          : undefined
      }
    >
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
            colSpan={6}
            empty={
              plan === null
                ? {
                    title: 'Nothing to preview yet',
                    hint: 'Choose a file, or pull from the portal. Nothing is written until you press Import.',
                  }
                : 'No rows in that file'
            }
          >
            {plan?.rows.map((row) => (
              <ImportRow key={row.line} row={row} />
            ))}
          </TableState>
        </TableBody>
      </Table>
    </ImportView>
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
