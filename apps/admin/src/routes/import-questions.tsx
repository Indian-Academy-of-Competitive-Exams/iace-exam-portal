import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Upload } from 'lucide-react';
import {
  IMPORT_ACCEPTED_EXTENSIONS,
  LANGUAGE_LABELS,
  QUESTION_INTAKE_HINTS,
  QUESTION_INTAKE_STATUSES,
  QUESTION_STATUS,
  QUESTION_IMPORT_TEMPLATE_FILENAME,
  XLSX_CONTENT_TYPE,
  type QuestionImportPlan,
  type QuestionImportRow,
  type QuestionIntakeStatus,
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
  Combobox,
  Field,
  FileDropzone,
  linkVariants,
  LoadingState,
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
import { api } from '../lib/api';
import { NAV_ITEMS, ROUTES } from '../lib/constants';
import { saveBlob } from '../lib/save-blob';

/**
 * Preview, then commit. Three bad rows still import the other 397.
 *
 * The file is uploaded once: the preview keeps it and hands back the run it
 * opened, so committing names that run instead of sending the same file again.
 */
function useQuestionImport() {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<QuestionImportPlan | null>(null);
  // The whole run lands in one status, so it is chosen once rather than per row.
  const [status, setStatus] = useState<QuestionIntakeStatus>(QUESTION_STATUS.DRAFT);

  const preview = useMutation({
    mutationFn: (chosen: File) => api.admin.imports.previewQuestions(chosen),
    onSuccess: setPlan,
  });

  const commit = useMutation({
    meta: {
      success: (data: unknown): string => {
        const result = data as { created: number; duplicates: number; invalid: number };
        return `Imported: ${result.created} created, ${result.duplicates} already in the bank, ${result.invalid} skipped.`;
      },
    },
    mutationFn: (importLogId: string) => api.admin.imports.commitQuestions(importLogId, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'questions'] }),
  });

  const sample = useMutation({
    mutationFn: () => api.admin.imports.questionTemplate(),
    onSuccess: (blob) => saveBlob(blob, QUESTION_IMPORT_TEMPLATE_FILENAME),
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
    status,
    setStatus,
    canCommit: plan !== null && plan.summary.willCreate > 0 && !commit.isSuccess,
  };
}

export function ImportQuestionsPage() {
  const { file, plan, preview, commit, sample, choose, status, setStatus, canCommit } =
    useQuestionImport();

  return (
    <PageFrame
      // Below lg the two columns stack, so the page scrolls; side by side they scroll separately.
      className="lg:overflow-hidden"
      header={<PageHeader breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />} title="Import questions" />}
    >
      <div className="grid gap-4 lg:h-full lg:min-h-0 lg:grid-cols-[2fr_1fr]">
        <Card className="relative order-2 p-4 lg:order-1 lg:min-h-0 lg:overflow-y-auto">
          {plan?.fileErrors.length ? (
            <Alert variant="danger" className="mb-4">
              <span>{plan.fileErrors.join(' ')}</span>
            </Alert>
          ) : null}

          {commit.data ? (
            <Alert variant="success" className="mb-4">
              <span>
                Imported: {commit.data.created} created, {commit.data.duplicates} already in the
                bank, {commit.data.invalid} skipped.{' '}
                <Link to={ROUTES.QUESTIONS} className={linkVariants({ variant: 'inline' })}>
                  View questions
                </Link>
              </span>
            </Alert>
          ) : null}

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
                    ? 'Choose an Excel file to see exactly what it would do. Nothing is written until you press Import.'
                    : 'No question rows in that file.'
                }
              >
                {plan?.rows.map((row) => (
                  <ImportRow key={row.line} row={row} />
                ))}
              </TableState>
            </TableBody>
          </Table>
        </Card>

        <div className="relative order-1 flex flex-col gap-4 lg:order-2 lg:min-h-0 lg:overflow-y-auto">
          <Card>
            <CardHeader>
              <CardTitle>Start from the template</CardTitle>
              <CardDescription>
                An Excel file with the right columns, two example rows, and dropdowns that follow
                each other: the topics offered are the ones under the subject you picked.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Button
                variant="outline"
                icon={<Download aria-hidden />}
                loading={sample.isPending}
                onClick={() => sample.mutate()}
              >
                Download template
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Your file</CardTitle>
              <CardDescription>
                Excel (.xlsx). A .csv from another system works too.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <FileDropzone
                accept={`${IMPORT_ACCEPTED_EXTENSIONS.join(',')},${XLSX_CONTENT_TYPE}`}
                file={file}
                onFileChange={choose}
                hint={IMPORT_ACCEPTED_EXTENSIONS.join(' or ')}
                aria-label="Question import file"
              />

              {preview.isPending ? <LoadingState>Reading the file…</LoadingState> : null}

              <Field htmlFor="import-status" label="Bring them in as">
                {(control) => (
                  <Combobox
                    id={control.id}
                    aria-describedby={control['aria-describedby']}
                    clearable={false}
                    value={status}
                    onChange={(next) => setStatus(next as QuestionIntakeStatus)}
                    items={QUESTION_INTAKE_STATUSES.map((value) => ({
                      value,
                      label: value,
                      hint: QUESTION_INTAKE_HINTS[value],
                    }))}
                  />
                )}
              </Field>

              {/* The preview already shows exactly what this does, row by row,
                  so it commits without asking a second time. */}
              <Button
                icon={<Upload aria-hidden />}
                loading={commit.isPending}
                disabled={!canCommit}
                onClick={() => plan && commit.mutate(plan.importLogId)}
              >
                Import {plan ? `${plan.summary.willCreate} questions` : ''}
              </Button>
            </CardContent>
          </Card>

          {plan ? (
            <Card>
              <CardHeader>
                <CardTitle>What this would do</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                <StatRow label="Rows read" value={plan.summary.total} />
                <StatRow label="New questions" value={plan.summary.willCreate} />
                <StatRow label="Already in the bank" value={plan.summary.duplicates} />
                <StatRow label="Skipped (have problems)" value={plan.summary.invalid} />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </PageFrame>
  );
}

function ImportRow({ row }: Readonly<{ row: QuestionImportRow }>) {
  const filedUnder = [row.subjectName, row.topicName].filter(Boolean).join(' / ');

  return (
    <TableRow>
      <TableCell numeric className="text-muted-foreground">
        {row.line}
      </TableCell>
      <TableCell className="max-w-sm">
        <TruncatedText>{row.stemPreview || '—'}</TruncatedText>
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
  if (row.action === 'create') return <Badge variant="success">Create</Badge>;

  // A repeat is not an error: re-uploading last week's sheet with ten new
  // questions on the end is the normal way to use this.
  if (row.action === 'duplicate') {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge variant="info">Already in the bank</Badge>
        {row.duplicateOf?.startsWith('line ') ? (
          <span className="text-xs text-muted-foreground">same as {row.duplicateOf}</span>
        ) : null}
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge variant="danger">Skip</Badge>
      <span className="text-xs text-destructive">
        {row.issues.map((issue) => issue.message).join('; ')}
      </span>
    </span>
  );
}
