import { Link } from 'react-router-dom';
import {
  IMPORT_ACCEPTED_EXTENSIONS,
  STUDENT_IMPORT_TEMPLATE_FILENAME,
  XLSX_CONTENT_TYPE,
  type StudentImportRow,
} from '@iace/contracts';
import {
  Badge,
  BadgeList,
  ImportView,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableState,
  TruncatedText,
  linkVariants,
} from '@iace/ui';
import { PageCrumbs, useImportScreen } from '@iace/app-kit/browser';
import { api } from '../../lib/api';
import { NAV_ITEMS, ROUTES } from '../../lib/constants';
import { useErrorRows } from './use-error-rows';

/** Preview, then commit. Three bad rows still import the other 397. */
export function ImportStudentsPage() {
  const intake = useImportScreen({
    preview: (file) => api.admin.imports.previewStudents(file),
    commit: (file) => api.admin.imports.commitStudents(file as File),
    writes: (plan) => plan.summary.willCreate + plan.summary.willUpdate,
    template: {
      fetch: () => api.admin.imports.studentTemplate(),
      filename: STUDENT_IMPORT_TEMPLATE_FILENAME,
    },
    success: (result) =>
      `Imported: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped.`,
  });

  const plan = intake.plan;
  const errorRows = useErrorRows(intake.file, plan?.summary.invalid ?? 0, (file) =>
    api.admin.imports.studentErrors(file),
  );

  return (
    <ImportView
      header={<PageHeader breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />} title="Import students" />}
      onDownloadTemplate={intake.downloadTemplate}
      downloadingTemplate={intake.isDownloadingTemplate}
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
      errorRows={errorRows}
      stats={
        plan
          ? [
              { label: 'Rows read', value: plan.summary.total },
              { label: 'New students', value: plan.summary.willCreate },
              { label: 'Existing students updated', value: plan.summary.willUpdate },
              { label: 'Skipped (have errors)', value: plan.summary.invalid },
            ]
          : undefined
      }
    >
      <Table>
        <thead>
          <TableRow>
            <TableHead numeric>Line</TableHead>
            <TableHead>Mobile</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>DOB</TableHead>
            <TableHead>Branch</TableHead>
            <TableHead>Reaches</TableHead>
            <TableHead>What happens</TableHead>
          </TableRow>
        </thead>
        <TableBody>
          <TableState
            isLoading={false}
            isEmpty={plan === null || plan.rows.length === 0}
            colSpan={7}
            empty={
              plan === null
                ? {
                    title: 'Nothing to preview yet',
                    hint: 'Choose a file. Nothing is written until you press Import.',
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
      <TableCell className="tabular-nums">{row.profile.dob ?? '—'}</TableCell>
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
          <Badge variant={row.action === 'create' ? 'success' : 'info'}>
            {row.action === 'create' ? 'Create' : 'Update'}
          </Badge>
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
