import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, PanelsTopLeft, Undo2, Upload } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  IMPORT_ACCEPTED_EXTENSIONS,
  LANGUAGE_LABELS,
  QUESTION_IMPORT_TEMPLATE_FILENAME,
  XLSX_CONTENT_TYPE,
  repeatedLineOf,
  type QuestionImportPlan,
  type QuestionImportRow,
  type QuestionImportResult,
} from '@iace/contracts';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DropdownMenuItem,
  ImportView,
  PageHeader,
  RowActions,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableState,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TruncatedText,
  cn,
  linkVariants,
  plural,
} from '@iace/ui';
import { PageCrumbs, useImportScreen, usePageTour } from '@iace/app-kit/browser';
import { api } from '../../lib/api';
import { NAV_ITEMS, QUERY_KEYS, ROUTES, sectionWorkQueryKey } from '../../lib/constants';
import { IMPORT_QUESTIONS_TOUR, TOUR_IDS } from '../../lib/tours';
import { useErrorRows } from './use-error-rows';
import { ImportWorkspace } from '../authoring/import-workspace';

/** The section a typist's import lands in; null for the bank. */
interface IntoSection {
  testId: string;
  sectionId: string;
}

/** The same sheet either way; a section's typist previews and commits through the section. */
function intakeFor(into: IntoSection | null) {
  return {
    preview: (file: File) =>
      into
        ? api.admin.sectionWork.previewImport(into.testId, into.sectionId, file)
        : api.admin.imports.previewQuestions(file),
    commit: (_file: File | null, plan: QuestionImportPlan) =>
      into
        ? api.admin.sectionWork.commitImport(into.testId, into.sectionId, plan.importLogId)
        : api.admin.imports.commitQuestions(plan.importLogId),
  };
}

function importedText({ created, duplicates, invalid, leftOut }: QuestionImportResult): string {
  const setAside = leftOut > 0 ? `, ${leftOut} left out` : '';
  return `Imported: ${created} created, ${duplicates} already in the bank, ${invalid} skipped${setAside}.`;
}

function ImportOutcome({
  result,
  into,
}: Readonly<{ result: QuestionImportResult; into: IntoSection | null }>) {
  return (
    <>
      {importedText(result)}{' '}
      <Link
        to={into ? ROUTES.TYPING_SECTION(into.testId, into.sectionId) : ROUTES.QUESTIONS}
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

/** A row repeated inside the file is counted apart from one already in the bank; a count of none is left out. */
function statsOf({ summary }: QuestionImportPlan, repeated: number) {
  return [
    { label: 'Rows read', value: summary.total },
    { label: 'New questions', value: summary.willCreate },
    { label: 'Already in the bank', value: summary.duplicates - repeated },
    ...(repeated > 0 ? [{ label: 'Repeated in this file', value: repeated }] : []),
    { label: 'Skipped (have problems)', value: summary.invalid },
    ...(summary.leftOut > 0 ? [{ label: 'Left out', value: summary.leftOut }] : []),
  ];
}

/** What an unsaved card edit stands in front of, and what each move does to it. */
const LEAVING = {
  PREVIEW: { drops: 'Going back to the preview drops them.', confirmLabel: 'Discard changes' },
  IMPORT: { drops: 'Import writes the sheet without them.', confirmLabel: 'Import without them' },
} as const;

type Leaving = keyof typeof LEAVING;

/** Registered only while the sheet is on screen: the authoring page over it registers its own. */
function SheetTour() {
  usePageTour({ id: TOUR_IDS.IMPORT_QUESTIONS, steps: IMPORT_QUESTIONS_TOUR, ready: true });
  return null;
}

// Preview, then commit — bad rows don't block the good ones; the file uploads once and commit just names the run the preview opened.
export function ImportQuestionsPage() {
  const { testId, sectionId } = useParams<{ testId?: string; sectionId?: string }>();
  const queryClient = useQueryClient();
  // The same sheet either way; the section is only where the questions land.
  const into = testId && sectionId ? { testId, sectionId } : null;

  const intake = useImportScreen({
    ...intakeFor(into),
    writes: (plan) => plan.summary.willCreate,
    template: {
      fetch: () => api.admin.imports.questionTemplate(),
      filename: QUESTION_IMPORT_TEMPLATE_FILENAME,
    },
    success: importedText,
    onCommitted: () => {
      if (!into) {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.QUESTIONS });
        return;
      }
      for (const queryKey of [QUERY_KEYS.AUTHORING, QUERY_KEYS.ASSIGNMENTS]) {
        void queryClient.invalidateQueries({ queryKey });
      }
      // Exact: the section's list gained questions; no card's own read changed.
      const section = sectionWorkQueryKey(into.testId, into.sectionId);
      void queryClient.invalidateQueries({ queryKey: section, exact: true });
    },
  });

  const plan = intake.plan;
  // A fresh preview opens on the authoring page; stepping back to the sheet is remembered per run.
  const [leftRun, setLeftRun] = useState<string | null>(null);
  const [startAt, setStartAt] = useState<string | null>(null);
  // Cards typed into and not saved: neither the preview nor Import has them.
  const [unsaved, setUnsaved] = useState(0);
  const [leaving, setLeaving] = useState<Leaving | null>(null);
  const reviewable = plan !== null && plan.rows.length > 0 && !intake.result;
  const review = (line: string | null) => {
    setStartAt(line);
    setLeftRun(null);
  };
  // Held against the run like a correction, so every row is judged again and a left-out one can come back.
  const leaveOut = useMutation({
    mutationFn: ({ run, line, leftOut }: { run: string; line: number; leftOut: boolean }) =>
      api.admin.imports.leaveOutQuestionRow(run, line, { leftOut }),
    onSuccess: (judged) => intake.stage(intake.file, judged),
  });
  const blurry = plan?.rows.reduce((count, row) => count + row.warnings.length, 0) ?? 0;
  const repeated = plan?.rows.filter((row) => repeatedLineOf(row.duplicateOf) !== null).length ?? 0;
  // A section's typist previews through authoring, which this bank-wide route does not answer for.
  const errorRows = useErrorRows(into ? null : intake.file, plan?.summary.invalid ?? 0, (file) =>
    api.admin.imports.questionErrors(file),
  );

  if (reviewable && leftRun !== plan.importLogId) {
    const moves: Record<Leaving, () => void> = {
      PREVIEW: () => setLeftRun(plan.importLogId),
      IMPORT: intake.commit,
    };
    const move = (to: Leaving) => (unsaved > 0 ? setLeaving(to) : moves[to]());
    return (
      <>
        <ImportWorkspace
          plan={plan}
          startAt={startAt}
          onPlan={(judged) => intake.stage(intake.file, judged)}
          onUnsavedChange={setUnsaved}
          actions={
            <>
              <Button type="button" size="sm" variant="outline" onClick={() => move('PREVIEW')}>
                <ArrowLeft aria-hidden />
                Preview
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!intake.canCommit}
                loading={intake.isCommitting}
                onClick={() => move('IMPORT')}
              >
                <Upload aria-hidden />
                {`Import ${plural(intake.writes, 'question')}`}
              </Button>
            </>
          }
        />

        {leaving ? (
          <ConfirmDialog
            open
            onOpenChange={(open) => !open && setLeaving(null)}
            destructive
            title="Discard the unsaved changes?"
            description={`${plural(unsaved, 'question')} on this page ${unsaved === 1 ? 'has' : 'have'} changes that were not saved. ${LEAVING[leaving].drops}`}
            confirmLabel={LEAVING[leaving].confirmLabel}
            onConfirm={() => {
              setLeaving(null);
              moves[leaving]();
            }}
          />
        ) : null}
      </>
    );
  }

  return (
    <ImportView
      header={
        <>
          <SheetTour />
          <PageHeader breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />} title="Import questions" />
        </>
      }
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
      onDownloadTemplate={intake.downloadTemplate}
      downloadingTemplate={intake.isDownloadingTemplate}
      dropzone={{
        accept: `${IMPORT_ACCEPTED_EXTENSIONS.join(',')},${XLSX_CONTENT_TYPE}`,
        file: intake.file,
        onFileChange: intake.choose,
        /* ui-copy-ok: format */ hint: IMPORT_ACCEPTED_EXTENSIONS.join(' or '),
        'aria-label': 'Question import file',
      }}
      previewing={intake.isPreviewing}
      action={{
        label: plan ? `Import ${plural(intake.writes, 'question')}` : 'Import',
        loading: intake.isCommitting,
        disabled: !intake.canCommit,
        onClick: intake.commit,
      }}
      fileErrors={plan?.fileErrors}
      outcome={intake.result ? <ImportOutcome result={intake.result} into={into} /> : null}
      errorRows={errorRows}
      stats={plan ? statsOf(plan, repeated) : undefined}
    >
      <BlurryNotice count={blurry} />

      <Table>
        <thead>
          <TableRow>
            <TableHead>Question</TableHead>
            <TableHead>Filed under</TableHead>
            <TableHead>Languages</TableHead>
            <TableHead>What happens</TableHead>
            <TableHead />
          </TableRow>
        </thead>
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
                onLeaveOut={
                  reviewable
                    ? (leftOut) =>
                        leaveOut.mutate({ run: plan.importLogId, line: row.line, leftOut })
                    : undefined
                }
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
  onLeaveOut,
}: Readonly<{
  row: QuestionImportRow;
  onOpen: (() => void) | undefined;
  /** Sets the row aside from Import or brings it back; absent once there is nothing left to import. */
  onLeaveOut: ((leftOut: boolean) => void) | undefined;
}>) {
  const filedUnder = [row.subjectName, row.topicName].filter(Boolean).join(' / ');
  const leftOut = row.action === 'left_out';

  return (
    <TableRow>
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
      <TableCell className="w-10">
        {onLeaveOut ? (
          <RowActions label={`Row ${row.line}`}>
            <DropdownMenuItem onSelect={() => onLeaveOut(!leftOut)}>
              {leftOut ? <Undo2 aria-hidden /> : <Ban aria-hidden />}
              {leftOut ? 'Bring back' : 'Leave out'}
            </DropdownMenuItem>
          </RowActions>
        ) : null}
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
    const repeats = repeatedLineOf(row.duplicateOf);
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        {repeats === null ? (
          <Badge variant="info">Already in the bank</Badge>
        ) : (
          <Badge variant="warning">{`Same as row ${repeats}`}</Badge>
        )}
        {edited}
      </span>
    );
  }

  if (row.action === 'left_out') {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge variant="neutral">Left out</Badge>
        {edited}
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
