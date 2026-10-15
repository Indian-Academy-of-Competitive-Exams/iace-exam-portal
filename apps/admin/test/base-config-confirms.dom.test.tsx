import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  ActorTypes,
  EXAM_TEMPLATE,
  FEATURE_KEYS,
  LANGUAGE_MODE,
  NAVIGATION_POLICY,
  PERMISSION_LEVELS,
  TEST_UI,
  TIMER_TEMPLATE,
  type AuthTokens,
  type BaseConfig,
  type BaseConfigDetail,
} from '@iace/contracts';
import { TooltipProvider } from '@iace/ui';
import './support/offline';
import { api, tokenStore } from '../src/lib/api';
import { ROUTES } from '../src/lib/constants';
import { AuthProvider } from '../src/providers/auth';
import { BaseConfigFormPage } from '../src/features/catalog/base-config-form';

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

const CONFIG_ID = 'cfg_1';
const COPY_ID = 'cfg_2';
const CURRENT_DEFAULT = 'SSC CGL Tier 1 official pattern';

const DETAIL: BaseConfigDetail = {
  id: CONFIG_ID,
  examStageId: 'stage_1',
  examStage: {
    id: 'stage_1',
    stageKey: 'TIER_1',
    name: 'Tier 1',
    exam: { id: 'exam_1', code: 'SSC_CGL', name: 'SSC CGL' },
  } as BaseConfigDetail['examStage'],
  name: 'My blueprint',
  isDefault: false,
  clonedFromId: null,
  version: 1,
  isActive: true,
  locked: false,
  totalQuestions: 25,
  totalMarks: 50,
  durationSec: 3600,
  timerTemplate: TIMER_TEMPLATE.COMPOSITE_FREE,
  navigation: NAVIGATION_POLICY.FREE,
  optionalSectionCount: null,
  defaultTestUi: TEST_UI.CBT,
  examTemplate: EXAM_TEMPLATE.DEFAULT,
  languageMode: LANGUAGE_MODE.SINGLE,
  languages: ['EN'],
  shuffleQuestions: false,
  shuffleOptions: false,
  calculatorEnabled: false,
  scoringVersion: 1,
  testCount: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
  modules: [],
  sections: [
    {
      id: 'sec_1',
      baseConfigId: CONFIG_ID,
      moduleId: null,
      name: 'Reasoning',
      order: 1,
      subjectId: null,
      questionCount: 25,
      marksPerQuestion: 2,
      negativeMarks: 0.5,
      durationSec: null,
      perQuestionSec: null,
      mandatory: true,
      meritOrQualifying: 'MERIT',
      qualifyingCutoff: null,
      patternNote: null,
      typingPreset: null,
      descriptive: false,
      languages: [],
    },
  ],
  updatedAt: '2026-09-01T00:00:00.000Z',
  editingBy: null,
};

function mount(detail: BaseConfigDetail, defaults: BaseConfig[] = []) {
  tokenStore.set({ accessToken: 'access', refreshToken: 'refresh' } as AuthTokens);
  mock.method(api.auth, 'me', () =>
    Promise.resolve({
      actor: ActorTypes.ADMIN,
      id: 'admin_1',
      email: 'ops@iace.co.in',
      fullName: null,
      isActive: true,
      isSuperAdmin: false,
      permissions: { [FEATURE_KEYS.TEST_MANAGEMENT]: PERMISSION_LEVELS.WRITE },
    }),
  );
  mock.method(api.admin.baseConfigs, 'detail', () => Promise.resolve(detail));
  mock.method(api.admin.baseConfigs, 'list', () =>
    Promise.resolve({ items: defaults, page: 1, pageSize: 1, total: defaults.length }),
  );
  mock.method(api.admin.examStages, 'list', () =>
    Promise.resolve({ items: [], page: 1, pageSize: 20, total: 0 }),
  );
  mock.method(api.admin.taxonomy, 'listSubjects', () =>
    Promise.resolve({ items: [], page: 1, pageSize: 20, total: 0 }),
  );
  render(
    <MemoryRouter initialEntries={[ROUTES.BASE_CONFIG(detail.id)]}>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <TooltipProvider>
            <Routes>
              <Route path={ROUTES.BASE_CONFIG_PATTERN} element={<BaseConfigFormPage />} />
            </Routes>
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

describe('cloning a locked configuration', () => {
  /** The failure this prevents: a copy made on one stray click, or a cancel that cloned anyway. */
  it('names what the copy starts as, sends nothing on Cancel, and clones the one it was opened on', async () => {
    const clone = mock.method(api.admin.baseConfigs, 'clone', () =>
      Promise.resolve({ ...DETAIL, id: COPY_ID }),
    );
    mount({ ...DETAIL, locked: true });

    await screen.findByRole('button', { name: 'Clone to change it' });
    click('Clone to change it');
    const dialog = await screen.findByRole('dialog');
    assert.ok(within(dialog).getByText('Clone My blueprint?'));
    assert.ok(within(dialog).getByText(/starts unlocked, is not the stage's default/));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
    assert.equal(clone.mock.callCount(), 0);

    click('Clone to change it');
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Clone configuration',
      }),
    );

    await waitFor(() => assert.equal(clone.mock.callCount(), 1));
    assert.equal(clone.mock.calls[0]?.arguments[0], CONFIG_ID);
  });
});

describe('making a configuration the stage default', () => {
  const holder = { ...DETAIL, id: 'cfg_9', name: CURRENT_DEFAULT, isDefault: true } as BaseConfig;

  const askToPromote = async () => {
    const update = mock.method(api.admin.baseConfigs, 'update', () => Promise.resolve(DETAIL));
    mount(DETAIL, [holder]);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByLabelText("The stage's default pattern"));
    click('Save configuration');
    return { update, dialog: await screen.findByRole('dialog') };
  };

  /** The failure this prevents: the stage's default taken off another pattern without a word. */
  it('names the pattern that loses it, and saves nothing on Cancel', async () => {
    const { update, dialog } = await askToPromote();
    assert.ok(
      within(dialog).getByText(new RegExp(`${CURRENT_DEFAULT} is the stage's default now`)),
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
    assert.equal(update.mock.callCount(), 0);
  });

  it('saves it as the default once confirmed', async () => {
    const { update, dialog } = await askToPromote();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Make it the default' }));

    await waitFor(() => assert.equal(update.mock.callCount(), 1));
    assert.equal(update.mock.calls[0]?.arguments[1]?.isDefault, true);
  });
});
