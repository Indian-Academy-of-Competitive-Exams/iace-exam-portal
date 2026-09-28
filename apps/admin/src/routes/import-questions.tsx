import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, PanelsTopLeft, Upload } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  IMPORT_ACCEPTED_EXTENSIONS,
  LANGUAGE_LABELS,
  QUESTION_IMPORT_TEMPLATE_FILENAME,
  XLSX_CONTENT_TYPE,
  type QuestionImportPlan,
  type QuestionImportRow,
} from '@iace/contracts';
import {
  Alert,
  Badge,
  Button,
  ImportView,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableState,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TruncatedText,
  cn,
  linkVariants,
} from '@iace/ui';
import { PageCrumbs, useImportScreen, usePageTour } from '@iace/app-kit/browser';
import { api } from '../lib/api';
import { NAV_ITEMS, QUERY_KEYS, ROUTES } from '../lib/constants';
import { IMPORT_QUESTIONS_TOUR, TOUR_IDS } from '../lib/tours';
import { saveBlob } from '../lib/save-blob';
import { useErrorRows } from '../lib/use-error-rows';
import { ImportWorkspace } from '../components/authoring/import-workspace';

/** The same sheet either way; a section's typist previews and commits through authoring. */
function intakeFor(into: string | null) {
  return {
    preview: (file: File) =>
      into
        ? api.admin.authoring.previewImport(into, file)
        : api.admin.imports.previewQuestions(file),
    commit: (_file: File | null, plan: QuestionImportPlan) =>
      into
        ? api.admin.authoring.commitImport(into, plan.importLogId)
        : api.admin.imports.commitQuestions(plan.importLogId),
  };
}

function ImportOutcome({
  result,
  into,
}: Readonly<{
  result: { created: number; duplicates: number; invalid: number };
  into: string | null;
}>) {
  return (
    <>
      Imported: {result.created} created, {result.duplicates} already in the bank, {result.invalid}{' '}
      skipped.{' '}
      <Link
        to={into ? ROUTES.AUTHORING_FOR_ASSIGNMENT(into) : ROUTES.QUESTIONS}
        className={linkVariants({ variant: 'inline' })}
      >
        {into ? 'Back to the section' : 'View questions'}
      </Link>
    </>
  );
}

function BlurryNotice({ count }: Readonly<{ count: number }>) {
  if (count === 0) return null;
  return (
    <Alert variant="warning">
      {String.raw`${count} ${count === 1 ? 'picture looks' : 'pictures look'} like a formula saved at text size. They import, but read blurry: type each as \( … \) in the sheet to make it a real equation.`}
    </Alert>
  );
}

// Preview, then commit — bad rows don't block the good ones; the file uploads once and commit just names the run the preview opened.
export function ImportQuestionsPage() {
  usePageTour({
    id: TOUR_IDS.IMPORT_QUESTIONS,
    steps: IMPORT_QUESTIONS_TOUR,
    ready: true,
  });

  const { assignmentId } = useParams<{ assignmentId?: string }>();
  const queryClient = useQueryClient();
  // The same sheet either way; the section is only where the questions land.
  const into = assignmentId ?? null;

  const template = useMutation({
    mutationFn: () => api.admin.imports.questionTemplate(),
    onSuccess: (blob) => saveBlob(blob, QUESTION_IMPORT_TEMPLATE_FILENAME),
  });

  const intake = useImportScreen({
    ...intakeFor(into),
    writes: (plan) => plan.summary.willCreate,
    success: (data) => {
      const result = data as { created: number; duplicates: number; invalid: number };
      return `Imported: ${result.created} created, ${result.duplicates} already in the bank, ${result.invalid} skipped.`;
    },
    onCommitted: () =>
      queryClient.invalidateQueries({
        queryKey: into ? QUERY_KEYS.AUTHORING : QUERY_KEYS.QUESTIONS,
      }),
  });

  const plan = intake.plan;
  // A fresh preview opens on the authoring page; stepping back to the sheet is remembered per run.
  const [leftRun, setLeftRun] = useState<string | null>(null);
  const [startAt, setStartAt] = useState<string | null>(null);
  const reviewable = plan !== null && plan.rows.length > 0 && !intake.result;
  const review = (line: string | null) => {
    setStartAt(line);
    setLeftRun(null);
  };
  const blurry = plan?.rows.reduce((count, row) => count + row.warnings.length, 0) ?? 0;
  // A section's typist previews through authoring, which this bank-wide route does not answer for.
  const errorRows = useErrorRows(into ? null : intake.file, plan?.summary.invalid ?? 0, (file) =>
    api.admin.imports.questionErrors(file),
  );

  if (reviewable && leftRun !== plan.importLogId) {
    return (
      <ImportWorkspace
        plan={plan}
        into={into}
        startAt={startAt}
        onPlan={(judged) => intake.stage(intake.file, judged)}
        actions={
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setLeftRun(plan.importLogId)}
            >
              <ArrowLeft aria-hidden />
              Preview
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!intake.canCommit}
              loading={intake.isCommitting}
              onClick={intake.commit}
            >
              <Upload aria-hidden />
              {`Import ${intake.writes} questions`}
            </Button>
          </>
        }
      />
    );
  }

  return (
    <ImportView
      header={<PageHeader breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />} title="Import questions" />}
      options={
        <>
          {into ? (
            <Alert variant="info">
              These questions land in the section you were assigned, not loose in the bank.
            </Alert>
          ) : null}
          {reviewable ? (
            <Button type="button" variant="outline" onClick={() => review(null)}>
              <PanelsTopLeft aria-hidden />
              Review questions
            </Button>
          ) : null}
        </>
      }
      onDownloadTemplate={() => template.mutate()}
      downloadingTemplate={template.isPending}
      dropzone={{
        accept: `${IMPORT_ACCEPTED_EXTENSIONS.join(',')},${XLSX_CONTENT_TYPE}`,
        file: intake.file,
        onFileChange: intake.choose,
        /* ui-copy-ok: format */ hint: IMPORT_ACCEPTED_EXTENSIONS.join(' or '),
        'aria-label': 'Question import file',
      }}
      previewing={intake.isPreviewing}
      action={{
        label: plan ? `Import ${intake.writes} questions` : 'Import',
        loading: intake.isCommitting,
        disabled: !intake.canCommit,
        onClick: intake.commit,
      }}
      fileErrors={plan?.fileErrors}
      outcome={intake.result ? <ImportOutcome result={intake.result} into={into} /> : null}
      errorRows={errorRows}
      stats={
        plan
          ? [
              { label: 'Rows read', value: plan.summary.total },
              { label: 'New questions', value: plan.summary.willCreate },
              { label: 'Already in the bank', value: plan.summary.duplicates },
              { label: 'Skipped (have problems)', value: plan.summary.invalid },
            ]
          : undefined
      }
    >
      <BlurryNotice count={blurry} />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead numeric>Line</TableHead>
            <TableHead>Question</TableHead>
            <TableHead>Filed under</TableHead>
            <TableHead>Languages</TableHead>
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
                ? {
                    title: 'Nothing to preview yet',
                    hint: 'Choose an Excel file. Nothing is written until you press Import.',
                  }
                : 'No question rows in that file'
            }
          >
            {plan?.rows.map((row) => (
              <ImportRow
                key={row.line}
                row={row}
                onOpen={reviewable ? () => review(String(row.line)) : undefined}
              />
            ))}
          </TableState>
        </TableBody>
      </Table>
    </ImportView>
  );
}

function ImportRow({
  row,
  onOpen,
}: Readonly<{ row: QuestionImportRow; onOpen: (() => void) | undefined }>) {
  const filedUnder = [row.subjectName, row.topicName].filter(Boolean).join(' / ');

  return (
    <TableRow>
      <TableCell numeric className="text-muted-foreground">
        {row.line}
      </TableCell>
      <TableCell className="max-w-sm">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className={cn(linkVariants(), 'max-w-full text-left')}
          >
            <TruncatedText>{row.stemPreview || '—'}</TruncatedText>
          </button>
        ) : (
          <TruncatedText>{row.stemPreview || '—'}</TruncatedText>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">{filedUnder || '—'}</TableCell>
      <TableCell className="text-muted-foreground">
        {row.languages.map((language) => LANGUAGE_LABELS[language]).join(', ') || '—'}
      </TableCell>
      <TableCell>
        <RowOutcome row={row} />
      </TableCell>
    </TableRow>
  );
}

function RowOutcome({ row }: Readonly<{ row: QuestionImportRow }>) {
  const edited = row.edited ? <Badge variant="neutral">Edited</Badge> : null;
  if (row.action === 'create') {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge variant="success">Create</Badge>
        {edited}
        {row.warnings.length > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="rounded-sm text-xs text-warning-ink focus-visible:shadow-focus focus-visible:outline-none"
              >
                {`${row.warnings.length} blurry ${row.warnings.length === 1 ? 'picture' : 'pictures'}`}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {row.warnings.map((warning) => warning.message).join(' ')}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </span>
    );
  }

  // A repeat is not an error — re-uploading last week's sheet with ten new rows added is normal use.
  if (row.action === 'duplicate') {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge variant="info">Already in the bank</Badge>
        {edited}
        {row.duplicateOf?.startsWith('line ') ? (
          <span className="text-xs text-muted-foreground">same as {row.duplicateOf}</span>
        ) : null}
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge variant="danger">Skip</Badge>
      {edited}
      <span className="text-xs text-destructive">
        {row.issues.map((issue) => issue.message).join('; ')}
      </span>
    </span>
  );
}
