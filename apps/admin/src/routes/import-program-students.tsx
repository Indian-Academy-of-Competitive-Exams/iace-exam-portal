import { Link, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import {
  IMPORT_ACCEPTED_EXTENSIONS,
  PROGRAM_IMPORT_TEMPLATE_FILENAME,
  XLSX_CONTENT_TYPE,
  type ProgramImportRow,
} from '@iace/contracts';
import {
  Badge,
  ImportView,
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
import { api } from '../lib/api';
import { saveBlob } from '../lib/save-blob';
import { COHORT_TABS, NAV_ITEMS, ROUTES } from '../lib/constants';

export function ImportProgramStudentsPage() {
  const { code = '' } = useParams();

  const template = useMutation({
    mutationFn: () => api.admin.imports.programTemplate(),
    onSuccess: (blob) => saveBlob(blob, PROGRAM_IMPORT_TEMPLATE_FILENAME),
  });

  const intake = useImportScreen({
    preview: (file) => api.admin.imports.previewProgramStudents(code, file),
    commit: (file) => api.admin.imports.commitProgramStudents(code, file as File),
    writes: (plan) => plan.summary.willEnrol,
    success: 'Students enrolled.',
  });

  const plan = intake.plan;

  return (
    <ImportView
      header={
        <PageHeader
          breadcrumbs={<PageCrumbs nav={NAV_ITEMS} tail={[{ label: 'Import students' }]} />}
          title="Import students"
          meta={code}
        />
      }
      onDownloadTemplate={() => template.mutate()}
      downloadingTemplate={template.isPending}
      dropzone={{
        accept: `${IMPORT_ACCEPTED_EXTENSIONS.join(',')},${XLSX_CONTENT_TYPE}`,
        file: intake.file,
        onFileChange: intake.choose,
        /* ui-copy-ok: format */ hint: IMPORT_ACCEPTED_EXTENSIONS.join(' or '),
        'aria-label': 'Program enrolment file',
      }}
      previewing={intake.isPreviewing}
      action={{
        label: plan ? `Import ${intake.writes} students` : 'Import',
        loading: intake.isCommitting,
        disabled: !intake.canCommit,
        onClick: intake.commit,
      }}
      fileErrors={plan?.fileErrors}
      outcome={
        intake.result ? (
          <>
            {intake.result.enrolled} enrolled, {intake.result.alreadyEnrolled} already carried it,{' '}
            {intake.result.skipped} skipped.{' '}
            <Link
              to={`${ROUTES.COHORTS}?tab=${COHORT_TABS.PROGRAMS}`}
              className={linkVariants({ variant: 'inline' })}
            >
              Back to programs
            </Link>
          </>
        ) : null
      }
      stats={
        plan
          ? [
              { label: 'Rows read', value: plan.summary.total },
              { label: 'Students to enrol', value: plan.summary.willEnrol },
              { label: 'Already carry it', value: plan.summary.alreadyEnrolled },
              { label: 'Skipped (have errors)', value: plan.summary.invalid },
            ]
          : undefined
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead numeric>Line</TableHead>
            <TableHead>Mobile</TableHead>
            <TableHead>Name on record</TableHead>
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

function ImportRow({ row }: Readonly<{ row: ProgramImportRow }>) {
  return (
    <TableRow>
      <TableCell numeric className="text-muted-foreground">
        {row.line}
      </TableCell>
      <TableCell className="max-w-36 tabular-nums">
        <TruncatedText>{row.mobile}</TruncatedText>
      </TableCell>
      {/* The name we hold, not the sheet's: it is what tells the admin they have the right person. */}
      <TableCell className="max-w-56">
        <TruncatedText>{row.studentName ?? row.fullName}</TruncatedText>
      </TableCell>
      <TableCell className="max-w-96">
        <RowOutcome row={row} />
      </TableCell>
    </TableRow>
  );
}

function RowOutcome({ row }: Readonly<{ row: ProgramImportRow }>) {
  if (row.action === 'enrol') return <Badge variant="success">Enrol</Badge>;
  if (row.action === 'already') return <Badge variant="neutral">Already enrolled</Badge>;

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge variant="danger">Skip</Badge>
      <span className="text-xs text-destructive">{row.errors.join('; ')}</span>
    </span>
  );
}
