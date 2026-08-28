import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, Upload } from 'lucide-react';
import {
  IMPORT_ACCEPTED_EXTENSIONS,
  SCHOLARSHIP_IMPORT_TEMPLATE_FILENAME,
  XLSX_CONTENT_TYPE,
  type ScholarshipImportRow,
} from '@iace/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  FileDropzone,
  FormSection,
  LoadingState,
  PageFrame,
  PageHeader,
  Skeleton,
  StatRow,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TruncatedText,
  linkVariants,
} from '@iace/ui';
import { PageCrumbs } from '@iace/app-kit/browser';
import { api } from '../lib/api';
import { saveBlob } from '../lib/save-blob';
import { NAV_ITEMS, QUERY_KEYS, ROUTES } from '../lib/constants';

const ACTION_LABELS: Readonly<Record<ScholarshipImportRow['action'], string>> = {
  create: 'New candidate',
  grant: 'Already registered',
  skip: 'Skipped',
};

export function ImportScholarshipPage() {
  const { id = '' } = useParams();
  const [file, setFile] = useState<File | null>(null);

  const series = useQuery({
    queryKey: [...QUERY_KEYS.TEST_SERIES, id],
    queryFn: () => api.admin.testSeries.detail(id),
  });

  const sample = useMutation({
    mutationFn: () => api.admin.imports.scholarshipTemplate(),
    onSuccess: (blob) => saveBlob(blob, SCHOLARSHIP_IMPORT_TEMPLATE_FILENAME),
  });

  const preview = useMutation({
    mutationFn: (chosen: File) => api.admin.imports.previewScholarship(id, chosen),
  });

  const commit = useMutation({
    meta: { success: 'Candidates imported.' },
    mutationFn: (chosen: File) => api.admin.imports.commitScholarship(id, chosen),
  });

  const choose = (next: File | undefined) => {
    setFile(next ?? null);
    commit.reset();
    preview.reset();
    if (next) preview.mutate(next);
  };

  const plan = preview.data;
  const canCommit = Boolean(file) && Boolean(plan) && plan!.summary.total > plan!.summary.invalid;

  return (
    <PageFrame
      className="lg:overflow-hidden"
      header={
        <PageHeader
          breadcrumbs={<PageCrumbs nav={NAV_ITEMS} tail={[{ label: 'Candidates' }]} />}
          title="Import candidates"
          meta={series.data?.name}
        />
      }
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
                {commit.data.created} created, {commit.data.granted} granted, {commit.data.skipped}{' '}
                skipped.{' '}
                <Link
                  to={ROUTES.TEST_SERIES_DETAIL(id)}
                  className={linkVariants({ variant: 'inline' })}
                >
                  Back to the series
                </Link>
              </span>
            </Alert>
          ) : null}

          {plan ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead numeric>Line</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.rows.map((row) => (
                  <TableRow key={row.line}>
                    <TableCell numeric>{row.line}</TableCell>
                    <TableCell className="max-w-36">
                      <TruncatedText>{row.mobile}</TruncatedText>
                    </TableCell>
                    <TableCell className="max-w-56">
                      <TruncatedText>{row.fullName}</TruncatedText>
                    </TableCell>
                    <TableCell className="max-w-72">
                      {row.action === 'skip' ? (
                        <TruncatedText>{row.errors.join(' ')}</TruncatedText>
                      ) : (
                        <Badge variant={row.action === 'create' ? 'info' : 'neutral'}>
                          {ACTION_LABELS[row.action]}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Alert variant="info">Choose a file to see what it would do.</Alert>
          )}
        </Card>

        <Card className="order-1 flex flex-col gap-6 p-4 lg:order-2 lg:min-h-0 lg:overflow-y-auto">
          {/* The sample comes first: the shape of the file matters before anywhere to put one. */}
          <FormSection title="Start from the sample">
            <Button
              variant="outline"
              icon={<Download aria-hidden />}
              loading={sample.isPending}
              onClick={() => sample.mutate()}
            >
              Download sample file
            </Button>
          </FormSection>

          <FormSection title="Your file">
            <div className="flex flex-col gap-3">
              <FileDropzone
                accept={`${IMPORT_ACCEPTED_EXTENSIONS.join(',')},${XLSX_CONTENT_TYPE}`}
                file={file}
                onFileChange={choose}
                /* ui-copy-ok: format */ hint={IMPORT_ACCEPTED_EXTENSIONS.join(' or ')}
                aria-label="Candidate import file"
              />

              {preview.isPending ? <LoadingState>Reading the file…</LoadingState> : null}
              {series.isPending ? <Skeleton variant="text" /> : null}

              <Button
                icon={<Upload aria-hidden />}
                loading={commit.isPending}
                disabled={!canCommit}
                onClick={() => file && commit.mutate(file)}
              >
                Import {plan ? `${plan.summary.total - plan.summary.invalid} candidates` : ''}
              </Button>
            </div>
          </FormSection>

          {plan ? (
            <FormSection title="Preview">
              <div className="flex flex-col gap-2 text-sm">
                <StatRow label="Rows read" value={plan.summary.total} />
                <StatRow label="New candidates" value={plan.summary.willCreate} />
                <StatRow label="Already registered" value={plan.summary.willGrant} />
                <StatRow label="Skipped (have errors)" value={plan.summary.invalid} />
              </div>
            </FormSection>
          ) : null}
        </Card>
      </div>
    </PageFrame>
  );
}
