import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  ActorTypes,
  AppException,
  ErrorCodes,
  ADMIN_ROLES,
  ASSIGNMENT_ROLES,
  PAPER_SOURCES,
  TEST_SCOPE,
  type Assignment,
  type AuthTokens,
  type BaseConfigDetail,
  type TestDetail,
} from '@iace/contracts';
import { TooltipProvider } from '@iace/ui';
import './support/offline';
import { api, tokenStore } from '../src/lib/api';
import { AuthProvider } from '../src/providers/auth';
import { AssignStep } from '../src/features/tests/test-builder-assign-step';

/** gcTime 0 and an explicit clear: react-query's default 5-minute timer outlives the run. */
const client = new QueryClient({
  defaultOptions: { queries: { gcTime: 0, retry: false }, mutations: { gcTime: 0 } },
});

afterEach(() => {
  cleanup();
  client.clear();
  tokenStore.clear();
  mock.restoreAll();
});

const TEST_ID = 'test_1';
const SECTION = 'Reasoning';
const SECTION_ID = 'sec_1';
const ASSIGNEE = 'Asha Typist';

const TEST = {
  id: TEST_ID,
  paperSource: PAPER_SOURCES.FRAMED,
  finalizedAt: null,
  attemptCount: 0,
  scope: TEST_SCOPE.FULL,
  scopeRef: null,
} as unknown as TestDetail;

const CONFIG = {
  sections: [{ id: SECTION_ID, name: SECTION, moduleId: null, questionCount: 10 }],
} as unknown as BaseConfigDetail;

const TYPIST_SEAT = {
  id: 'asg_1',
  testId: TEST_ID,
  baseConfigSectionId: SECTION_ID,
  sectionName: SECTION,
  assigneeId: 'admin_2',
  assigneeName: ASSIGNEE,
  role: ASSIGNMENT_ROLES.TYPIST,
  dueAt: '2026-12-01',
  finalizedAt: null,
  standing: null,
  secondsSpent: null,
  writtenCount: 0,
  handedAt: null,
  replacedAt: null,
  removable: true,
} as unknown as Assignment;

function mount(seats: Assignment[]) {
  tokenStore.set({ accessToken: 'access', refreshToken: 'refresh' } as AuthTokens);
  mock.method(api.auth, 'me', () =>
    Promise.resolve({
      actor: ActorTypes.ADMIN,
      id: 'admin_1',
      email: 'ops@iace.co.in',
      fullName: null,
      isActive: true,
      isSuperAdmin: true,
      permissions: {},
    }),
  );
  mock.method(api.admin.assignments, 'forTest', () => Promise.resolve(seats));
  mock.method(api.admin.tests, 'readPaper', () => Promise.resolve({ sections: [] }));
  mock.method(api.admin.assignments, 'assignable', () =>
    Promise.resolve([{ id: 'admin_2', fullName: ASSIGNEE, role: ADMIN_ROLES.TYPIST }]),
  );
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <TooltipProvider>
            <AssignStep detail={TEST} config={CONFIG} />
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const openActions = (trigger: HTMLElement) => fireEvent.keyDown(trigger, { key: 'Enter' });

describe('assigning a section from the test builder', () => {
  /** The failure this prevents: a section handed to the wrong admin or role, or a refused due day shown nowhere. */
  it('sends the chosen admin, section and role, and puts a refused due day under its field', async () => {
    const refusal = 'Give a due date';
    const assign = mock.method(api.admin.assignments, 'assign', () =>
      Promise.reject(
        new AppException(ErrorCodes.VALIDATION_ERROR, 'Some of the details are not valid', {
          fieldErrors: { dueAt: [refusal] },
        }),
      ),
    );
    mount([]);

    fireEvent.click((await screen.findAllByRole('button', { name: 'Assign' }))[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog');
    assert.ok(within(dialog).getByText(`Assign a typist to ${SECTION}`));

    fireEvent.click(within(dialog).getByLabelText('Assignee'));
    fireEvent.click(await screen.findByRole('option', { name: ASSIGNEE }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));

    assert.ok(await screen.findByText(refusal));
    assert.equal(assign.mock.callCount(), 1);
    const [testId, body] = assign.mock.calls[0]?.arguments ?? [];
    assert.equal(testId, TEST_ID);
    assert.equal(body?.baseConfigSectionId, SECTION_ID);
    assert.equal(body?.assigneeId, 'admin_2');
    assert.equal(body?.role, ASSIGNMENT_ROLES.TYPIST);
  });
});

describe('removing a seat from the test builder', () => {
  /** The failure this prevents: a seat taken back on the click of a menu item, before anyone is asked. */
  it('asks naming who and where, sends nothing on Cancel, and removes that seat once confirmed', async () => {
    const remove = mock.method(api.admin.assignments, 'remove', () =>
      Promise.resolve(undefined as never),
    );
    mount([TYPIST_SEAT]);

    openActions(await screen.findByRole('button', { name: `Actions for ${SECTION}` }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove typist' }));
    const dialog = await screen.findByRole('dialog');
    assert.ok(within(dialog).getByText(`Remove ${ASSIGNEE} from ${SECTION}?`));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
    assert.equal(remove.mock.callCount(), 0);

    openActions(screen.getByRole('button', { name: `Actions for ${SECTION}` }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove typist' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }),
    );

    await waitFor(() => assert.equal(remove.mock.callCount(), 1));
    assert.deepEqual(remove.mock.calls[0]?.arguments, [TEST_ID, 'asg_1']);
  });
});
