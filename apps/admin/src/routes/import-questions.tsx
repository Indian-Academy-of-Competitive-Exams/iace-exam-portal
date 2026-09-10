import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  IMPORT_ACCEPTED_EXTENSIONS,
  LANGUAGE_LABELS,
  QUESTION_INTAKE_HINTS,
  QUESTION_INTAKE_STATUSES,
  QUESTION_STATUS,
  QUESTION_IMPORT_TEMPLATE_FILENAME,
  XLSX_CONTENT_TYPE,
  type QuestionImportRow,
  type QuestionIntakeStatus,
} from '@iace/contracts';
import {
  Badge,
  Combobox,
  Field,
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
import { NAV_ITEMS, QUERY_KEYS, ROUTES } from '../lib/constants';
import { saveBlob } from '../lib/save-blob';

/**
 * Preview, then commit. Three bad rows still import the other 397.
 *
 * The file is uploaded once: the preview keeps it and hands back the run it
 * opened, so committing names that run instead of sending the same file again.
 */
export function ImportQuestionsPage() {
  const queryClient = useQueryClient();
  // The whole run lands in one status, so it is chosen once rather than per row.
  const [status, setStatus] = useState<QuestionIntakeStatus>(QUESTION_STATUS.DRAFT);

  const template = useMutation({
    mutationFn: () => api.admin.imports.questionTemplate(),
    onSuccess: (blob) => saveBlob(blob, QUESTION_IMPORT_TEMPLATE_FILENAME),
  });

  const intake = useImportScreen({
    preview: (file) => api.admin.imports.previewQuestions(file),
    commit: (_file, plan) => api.admin.imports.commitQuestions(plan.importLogId, status),
    writes: (plan) => plan.summary.willCreate,
    success: (data) => {
      const result = data as { created: number; duplicates: number; invalid: number };
      return `Imported: ${result.created} created, ${result.duplicates} already in the bank, ${result.invalid} skipped.`;
    },
    onCommitted: () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.QUESTIONS }),
  });

  const plan = intake.plan;

  return (
    <ImportView
      header={<PageHeader breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />} title="Import questions" />}
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
      options={
        <Field htmlFor="import-status" label="Status">
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
      }
      action={{
        label: plan ? `Import ${intake.writes} questions` : 'Import',
        loading: intake.isCommitting,
        disabled: !intake.canCommit,
        onClick: intake.commit,
      }}
      fileErrors={plan?.fileErrors}
      outcome={
        intake.result ? (
          <>
            Imported: {intake.result.created} created, {intake.result.duplicates} already in the
            bank, {intake.result.invalid} skipped.{' '}
            <Link to={ROUTES.QUESTIONS} className={linkVariants({ variant: 'inline' })}>
              View questions
            </Link>
          </>
        ) : null
      }
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
              <ImportRow key={row.line} row={row} />
            ))}
          </TableState>
        </TableBody>
      </Table>
    </ImportView>
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
