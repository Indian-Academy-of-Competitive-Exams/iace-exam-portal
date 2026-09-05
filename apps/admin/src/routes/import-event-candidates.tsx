import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  CANDIDATE_IMPORT_TEMPLATE_FILENAME,
  IMPORT_ACCEPTED_EXTENSIONS,
  XLSX_CONTENT_TYPE,
  type CandidateImportRow,
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
import { NAV_ITEMS, QUERY_KEYS, ROUTES } from '../lib/constants';

const ACTION_LABELS: Readonly<Record<CandidateImportRow['action'], string>> = {
  create: 'New candidate',
  add: 'Already registered',
  skip: 'Skipped',
};

export function ImportEventCandidatesPage() {
  const { id = '' } = useParams();

  const event = useQuery({
    queryKey: [...QUERY_KEYS.EVENTS, id],
    queryFn: () => api.admin.events.detail(id),
  });

  const template = useMutation({
    mutationFn: () => api.admin.imports.candidateTemplate(),
    onSuccess: (blob) => saveBlob(blob, CANDIDATE_IMPORT_TEMPLATE_FILENAME),
  });

  const intake = useImportScreen({
    preview: (file) => api.admin.imports.previewEventCandidates(id, file),
    commit: (file) => api.admin.imports.commitEventCandidates(id, file as File),
    writes: (plan) => plan.summary.total - plan.summary.invalid,
    success: 'Candidates imported.',
  });

  const plan = intake.plan;

  return (
    <ImportView
      header={
        <PageHeader
          breadcrumbs={<PageCrumbs nav={NAV_ITEMS} tail={[{ label: 'Import candidates' }]} />}
          title="Import candidates"
          meta={event.data?.name}
        />
      }
      onDownloadTemplate={() => template.mutate()}
      downloadingTemplate={template.isPending}
      dropzone={{
        accept: `${IMPORT_ACCEPTED_EXTENSIONS.join(',')},${XLSX_CONTENT_TYPE}`,
        file: intake.file,
        onFileChange: intake.choose,
        /* ui-copy-ok: format */ hint: IMPORT_ACCEPTED_EXTENSIONS.join(' or '),
        'aria-label': 'Candidate import file',
      }}
      previewing={intake.isPreviewing}
      action={{
        label: `Import ${plan ? `${intake.writes} candidates` : ''}`.trim(),
        loading: intake.isCommitting,
        disabled: !intake.canCommit,
        onClick: intake.commit,
      }}
      fileErrors={plan?.fileErrors}
      outcome={
        intake.result ? (
          <>
            {intake.result.created} created, {intake.result.added} on the event,{' '}
            {intake.result.skipped} skipped.{' '}
            <Link to={ROUTES.EVENTS} className={linkVariants({ variant: 'inline' })}>
              Back to events
            </Link>
          </>
        ) : null
      }
      stats={
        plan
          ? [
              { label: 'Rows read', value: plan.summary.total },
              { label: 'New candidates', value: plan.summary.willCreate },
              { label: 'Already registered', value: plan.summary.willAdd },
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
            <TableHead>Name</TableHead>
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
                ? 'Choose a file to see exactly what it would do. Nothing is written until you press Import.'
                : 'No rows in that file.'
            }
          >
            {plan?.rows.map((row) => (
              <TableRow key={row.line}>
                <TableCell numeric className="text-muted-foreground">
                  {row.line}
                </TableCell>
                <TableCell className="max-w-36 tabular-nums">
                  <TruncatedText>{row.mobile}</TruncatedText>
                </TableCell>
                <TableCell className="max-w-56">
                  <TruncatedText>{row.fullName}</TruncatedText>
                </TableCell>
                <TableCell className="max-w-72">
                  {row.action === 'skip' ? (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="danger">Skip</Badge>
                      <span className="text-xs text-destructive">{row.errors.join('; ')}</span>
                    </span>
                  ) : (
                    <Badge variant={row.action === 'create' ? 'success' : 'info'}>
                      {ACTION_LABELS[row.action]}
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableState>
        </TableBody>
      </Table>
    </ImportView>
  );
}
