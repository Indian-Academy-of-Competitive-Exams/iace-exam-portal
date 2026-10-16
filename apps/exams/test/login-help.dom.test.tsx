import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { SUPPORT_FALLBACK_EMAIL } from '@iace/contracts';
import { ThemeProvider, TooltipProvider } from '@iace/ui';
import './support/offline';
import { api } from '../src/lib/api';
import { LoginHelpPage } from '../src/features/support/login-help';

/** gcTime 0 on both: a mutation's default 5-minute timer keeps the run alive after it passes. */
const client = new QueryClient({
  defaultOptions: { queries: { gcTime: 0, retry: false }, mutations: { gcTime: 0 } },
});

afterEach(() => {
  cleanup();
  client.clear();
  mock.restoreAll();
});

const BRANCH = { id: '00000000-0000-4000-8000-000000000001', name: 'Hyderabad' };
const EMAIL = 'ravi@example.com';

function mount() {
  mock.method(api.auth.loginHelp, 'branches', () => Promise.resolve([BRANCH]));
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <TooltipProvider>
            <LoginHelpPage />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

async function choose(label: string, option: string) {
  const trigger = screen.getByRole('button', { name: label });
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(option) }));
  // The closing popover hands focus back a tick later; a second one opened before that is dismissed by it.
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

describe('sign-in help', () => {
  it('always shows the address to mail when the form is not enough', () => {
    mount();

    assert.ok(screen.getByText(new RegExp(SUPPORT_FALLBACK_EMAIL)));
  });

  /** The failure this prevents: a signed-out student left guessing whether anyone got their query. */
  it('sends the query and says where the reply will go', async () => {
    const submit = mock.method(api.auth.loginHelp, 'submit', () =>
      Promise.resolve({ received: true as const }),
    );
    mount();

    type('Full name', 'Ravi Kumar');
    type("Father's name", 'Suresh Kumar');
    type('Registered mobile', '9876543210');
    type('Email', EMAIL);
    type('Message', 'The code never comes through.');
    await choose('Problem', 'The code never arrives');
    await choose('Branch', BRANCH.name);
    fireEvent.click(screen.getByRole('button', { name: 'Date of birth' }));
    const calendar = await screen.findByRole('table', { name: 'Calendar' });
    const days = within(calendar)
      .getAllByRole('button')
      .filter((day) => !(day as HTMLButtonElement).disabled);
    fireEvent.click(days[0] as HTMLElement);

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    assert.ok(await screen.findByText(`Query received. We will reply to ${EMAIL}.`));
    assert.equal(submit.mock.callCount(), 1);
    const sent = submit.mock.calls[0]?.arguments[0];
    assert.equal(sent?.branchId, BRANCH.id);
    assert.equal(sent?.contactMobile, undefined);
    assert.ok(screen.getByText(new RegExp(SUPPORT_FALLBACK_EMAIL)));
  });

  /** The failure this prevents: a student shown a parser's words for a field they left blank. */
  it('names what each blank field needs in plain words', async () => {
    mount();

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    for (const message of [
      'Enter your full name',
      "Enter your father's name",
      'Enter your date of birth',
      'Choose your branch',
      'Choose what is wrong',
      'Write a message',
    ]) {
      assert.ok(await screen.findByText(message), message);
    }
    assert.equal(screen.queryByText(/Invalid/), null);
  });
});
