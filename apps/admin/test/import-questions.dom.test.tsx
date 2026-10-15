import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  QUESTION_VALIDATION_CODE,
  type QuestionImportPlan,
  type QuestionImportResult,
  type QuestionImportRow,
} from '@iace/contracts';
import { TooltipProvider } from '@iace/ui';
import { TourProvider } from '@iace/app-kit/browser';
import './support/offline';
import { api } from '../src/lib/api';
import { AuthProvider } from '../src/providers/auth';
import { ImportQuestionsPage } from '../src/features/imports/import-questions';

/** gcTime 0 and an explicit clear: react-query's default 5-minute timer outlives the run. */
const client = new QueryClient({
  defaultOptions: { queries: { gcTime: 0, retry: false }, mutations: { gcTime: 0 } },
});

afterEach(() => {
  cleanup();
  client.clear();
  mock.restoreAll();
});

const RUN = 'run_1';
const BAD_REASON = 'The correct option is missing';

const row = (line: number, over: Partial<QuestionImportRow>): QuestionImportRow => ({
  line,
  action: 'create',
  stemPreview: `Question on line ${line}`,
  subjectName: null,
  topicName: null,
  languages: ['en'],
  issues: [],
  warnings: [],
  edited: false,
  duplicateOf: null,
  ...over,
});

const GOOD = row(2, {});
const BAD = row(3, {
  action: 'skip',
  issues: [{ code: QUESTION_VALIDATION_CODE.CORRECT_OPTION_REQUIRED, message: BAD_REASON }],
});

const planOf = (rows: QuestionImportRow[]): QuestionImportPlan => ({
  rows,
  fileErrors: [],
  importLogId: RUN,
  summary: {
    total: rows.length,
    willCreate: rows.filter((one) => one.action === 'create').length,
    duplicates: 0,
    invalid: rows.filter((one) => one.action === 'skip').length,
    leftOut: 0,
  },
});

function mount(plan: QuestionImportPlan) {
  mock.method(api.admin.imports, 'previewQuestions', () => Promise.resolve(plan));
  mock.method(api.admin.imports, 'questionDrafts', () => Promise.resolve([]));
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <TooltipProvider>
            <TourProvider storage={localStorage} storageKey="admin.tours">
              <ImportQuestionsPage />
            </TourProvider>
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** The sheet, with a file chosen, stepped back from the review window to the preview table. */
async function previewSheet() {
  const sheet = new File(['x'], 'questions.xlsx');
  fireEvent.change(screen.getByLabelText('Question import file'), { target: { files: [sheet] } });
  fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
}

describe('previewing a question sheet with a bad row', () => {
  /** The failure this prevents: Import counting, or writing, rows the preview says it will skip. */
  it('shows the row and why, counts only the valid one, and commits the run, not the rows', async () => {
    const result: QuestionImportResult = { ...planOf([GOOD, BAD]).summary, created: 1, skipped: 1 };
    const commit = mock.method(api.admin.imports, 'commitQuestions', () => Promise.resolve(result));
    mount(planOf([GOOD, BAD]));

    await previewSheet();

    assert.ok(await screen.findByText(BAD_REASON));
    assert.ok(screen.getByText('Skip'));
    const importButton = screen.getByRole('button', { name: 'Import 1 question' });
    assert.equal((importButton as HTMLButtonElement).disabled, false);

    fireEvent.click(importButton);

    await waitFor(() => assert.equal(commit.mock.callCount(), 1));
    assert.deepEqual(commit.mock.calls[0]?.arguments, [RUN]);
    assert.ok(await screen.findByText(/Imported: 1 created, 0 already in the bank, 1 skipped/));
  });

  /** The failure this prevents: an Import button live on a sheet where nothing would be written. */
  it('offers nothing to import when every row has a problem', async () => {
    const commit = mock.method(api.admin.imports, 'commitQuestions', () =>
      Promise.reject(new Error('should not be called')),
    );
    mount(planOf([BAD]));

    await previewSheet();

    assert.ok(await screen.findByText(BAD_REASON));
    const importButton = screen.getByRole('button', { name: 'Import 0 questions' });
    assert.equal((importButton as HTMLButtonElement).disabled, true);
    fireEvent.click(importButton);
    assert.equal(commit.mock.callCount(), 0);
  });
});
