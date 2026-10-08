import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppException, ErrorCodes, type CreateBaseConfigInput } from '@iace/contracts';
import { TooltipProvider } from '@iace/ui';
import './support/offline';
import { api } from '../src/lib/api';
import { AuthProvider } from '../src/providers/auth';
import { BaseConfigFormPage } from '../src/features/catalog/base-config-form';

/** gcTime 0 and an explicit clear: react-query's default 5-minute timer outlives the run. */
const client = new QueryClient({
  defaultOptions: { queries: { gcTime: 0, retry: false }, mutations: { gcTime: 0 } },
});

afterEach(() => {
  cleanup();
  client.clear();
  mock.restoreAll();
});

const EMPTY_PAGE = { items: [], page: 1, pageSize: 20, total: 0 };
const NOT_VALID = 'Some of the details are not valid';

/** A new configuration: no id on the route, so the form opens empty and editable. */
function mount() {
  mock.method(api.admin.examStages, 'list', () => Promise.resolve(EMPTY_PAGE));
  mock.method(api.admin.taxonomy, 'listSubjects', () => Promise.resolve(EMPTY_PAGE));
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <TooltipProvider>
            <BaseConfigFormPage />
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const refusing = (fieldErrors: Record<string, string[]>) =>
  mock.method(api.admin.baseConfigs, 'create', () =>
    Promise.reject(new AppException(ErrorCodes.VALIDATION_ERROR, NOT_VALID, { fieldErrors })),
  );

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Create configuration' }));

const isInvalid = (id: string) =>
  document.getElementById(id)?.getAttribute('aria-invalid') === 'true';

describe('a number field on the configuration form', () => {
  /** The failure this prevents: "two" read as blank and saved as zero questions, without a word. */
  it('refuses text under the field before anything is sent, and still takes a blank as not set', async () => {
    const create = mock.method(api.admin.baseConfigs, 'create', (_body: CreateBaseConfigInput) =>
      Promise.reject(new AppException(ErrorCodes.VALIDATION_ERROR, NOT_VALID)),
    );
    mount();

    type('Questions', 'two');
    save();

    assert.ok(await screen.findByText('Enter a number'));
    assert.equal(isInvalid('sections.0.questionCount'), true);
    assert.equal(create.mock.callCount(), 0);

    type('Questions', '25');
    save();

    await waitFor(() => assert.equal(create.mock.callCount(), 1));
    const [body] = create.mock.calls[0]?.arguments ?? [];
    assert.equal(body?.sections[0]?.questionCount, 25);
    assert.equal(body?.optionalSectionCount, null);
  });
});

describe('a server refusal on the configuration form', () => {
  /** The failure this prevents: a section's blank name shown under the configuration's own Name. */
  it('lands on the row it names and nowhere else, with no banner repeating it', async () => {
    refusing({
      'sections.0.name': ['Give the section a name'],
      'sections.0.durationSec': ['A clock cannot be negative'],
    });
    mount();

    save();

    assert.ok(await screen.findByText('Give the section a name'));
    assert.ok(screen.getByText('A clock cannot be negative'));
    assert.equal(isInvalid('sections.0.name'), true);
    assert.equal(isInvalid('sections.0.durationMin'), true);
    assert.equal(isInvalid('name'), false);
    assert.equal(isInvalid('durationMin'), false);
    assert.equal(screen.queryByText(NOT_VALID), null);
  });

  /** The failure this prevents: an error on a field nothing re-validates, blocking every later save. */
  it('under Languages is cleared by the next tick, and the save goes out again', async () => {
    const refusal = 'Offer the paper in at least one language';
    const create = refusing({ languages: [refusal] });
    mount();

    save();
    assert.ok(await screen.findByText(refusal));
    assert.equal(screen.queryByText(NOT_VALID), null);

    fireEvent.click(screen.getByLabelText('Hindi'));
    await waitFor(() => assert.equal(screen.queryByText(refusal), null));

    save();
    await waitFor(() => assert.equal(create.mock.callCount(), 2));
  });

  it('is said in the banner when no input owns it', async () => {
    refusing({ 'sections.0.order': ['Too big'] });
    mount();

    save();

    assert.ok(await screen.findByText(NOT_VALID));
  });
});
