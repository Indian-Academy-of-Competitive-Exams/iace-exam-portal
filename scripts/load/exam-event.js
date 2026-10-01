/**
 * k6 against a running API. The five load tiers are five scenarios in one file.
 * Paths and payloads mirror packages/contracts; keep them in step with it.
 * Raise RATE_LIMIT_AUTH_PER_MIN on the target first — auth is 120/min per IP.
 * k6 run -e BASE=https://api.staging -e TIER=sitting scripts/load/exam-event.js
 */
import http from 'k6/http';
import exec from 'k6/execution';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Rate } from 'k6/metrics';

// ---- Knobs -----------------------------------------------------------------

const BASE = (__ENV.BASE || 'http://localhost:3000').replace(/\/$/, '');
const CDN = (__ENV.CDN || BASE).replace(/\/$/, '');
const TIER = __ENV.TIER || 'all';
const DURATION = __ENV.DURATION || '5m';

const CANDIDATES = Number(__ENV.CANDIDATES || 1000);
const OPEN_WINDOW_SEC = Number(__ENV.OPEN_WINDOW_SEC || 120);
const SITTING_SEC = Number(__ENV.SITTING_SEC || 300);
const AUTOSAVE_SEC = Number(__ENV.AUTOSAVE_SEC || 25);
const LOGIN_PEAK_RPS = Number(__ENV.LOGIN_PEAK_RPS || 40);
const AFTERMATH_RPS = Number(__ENV.AFTERMATH_RPS || 20);
const ADMIN_RPS = Number(__ENV.ADMIN_RPS || 2);
const ASSET_RPS = Number(__ENV.ASSET_RPS || 20);

const TIERS = {
  SITTING: 'sitting',
  AFTERMATH: 'aftermath',
  LOGIN: 'login',
  ADMIN: 'admin',
  ASSETS: 'assets',
  SETUP: 'setup',
};

const ANSWER_STATE = { ANSWERED: 'ANSWERED', NOT_ANSWERED: 'NOT_ANSWERED' };
const JSON_HEADERS = { 'x-client': 'WEB', 'content-type': 'application/json' };

const throttled = new Counter('throttled_429');
const savesApplied = new Rate('autosave_applied');

// ---- Accounts --------------------------------------------------------------

/** A CSV of `mobile,pin` beats generated numbers; generated ones assume a seeded block. */
const ACCOUNTS = new SharedArray('accounts', () => {
  if (__ENV.ACCOUNTS) {
    return open(__ENV.ACCOUNTS)
      .trim()
      .split('\n')
      .slice(1)
      .filter((line) => line.trim())
      .map((line) => {
        const cells = line.split(',');
        return { mobile: cells[0].trim(), pin: cells[1].trim() };
      });
  }
  const base = Number(__ENV.MOBILE_BASE || '9000000000');
  const pin = __ENV.PIN || '1234';
  const count = Number(__ENV.ACCOUNT_COUNT || CANDIDATES);
  return Array.from({ length: count }, (_, i) => ({ mobile: String(base + i), pin }));
});

const myAccount = () => ACCOUNTS[(exec.vu.idInTest - 1) % ACCOUNTS.length];

// ---- One call ---------------------------------------------------------------

function params(token, tier, op, parse) {
  const headers = {
    'x-client': JSON_HEADERS['x-client'],
    'content-type': JSON_HEADERS['content-type'],
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const sent = { headers, tags: { tier, op }, timeout: '30s' };
  // Bodies are discarded globally, so only a call whose payload we actually read asks for one.
  if (parse) sent.responseType = 'text';
  return sent;
}

/** Returns the envelope's `data` when read, `true` when only the status mattered, null on a miss. */
function call(method, path, payload, token, tier, op, parse) {
  const body = payload === undefined ? null : JSON.stringify(payload);
  const res = http.request(method, `${BASE}${path}`, body, params(token, tier, op, parse));

  if (res.status === 429) {
    throttled.add(1, { op });
    return null;
  }
  if (!check(res, { [`${op} 2xx`]: (r) => r.status >= 200 && r.status < 300 })) return null;
  if (!parse) return true;

  try {
    const envelope = res.json();
    return envelope && envelope.success ? envelope.data : null;
  } catch (error) {
    return null;
  }
}

function client(token, tier) {
  return {
    read: (method, path, op, payload) => call(method, path, payload, token, tier, op, true),
    fire: (method, path, op, payload) => call(method, path, payload, token, tier, op, false),
  };
}

function login(account, tier, op) {
  const session = client(null, tier).read('POST', '/auth/student/login', op, account);
  return session ? session.tokens : null;
}

/** The first test the catalog says this student may start, which is what an event looks like. */
function startableTest(catalog) {
  for (const series of catalog.series) {
    for (const test of series.tests) {
      if (test.canStart) return test.id;
    }
  }
  return null;
}

// ---- Tier 1: the live sitting ----------------------------------------------

function answerBatch(questions, from, count, firstActionAt) {
  const batch = [];
  for (let i = from; i < Math.min(from + count, questions.length); i += 1) {
    const question = questions[i];
    const option = question.o.length ? question.o[i % question.o.length] : null;
    batch.push({
      questionId: question.q,
      state: option ? ANSWER_STATE.ANSWERED : ANSWER_STATE.NOT_ANSWERED,
      selectedOptionId: option,
      typedAnswer: null,
      timeSpentSec: 20 + (i % 30),
      firstActionAt,
    });
  }
  return batch;
}

export function sitting(setup) {
  if (!setup.testId || !setup.questions.length) return;
  sleep(Math.random() * OPEN_WINDOW_SEC);

  const tokens = login(myAccount(), TIERS.SITTING, 'warmup_login');
  if (!tokens) return;
  const api = client(tokens.accessToken, TIERS.SITTING);
  const testId = setup.testId;

  api.fire('GET', '/me/catalog', 'catalog');
  api.fire('GET', `/me/tests/${testId}/brief`, 'brief');
  // Transferred for real and thrown away: eight thousand VUs each holding a paper is gigabytes.
  api.fire('GET', `/me/tests/${testId}/paper`, 'test_paper');

  const tab = `k6-${exec.vu.idInTest}`;
  const started = api.read('POST', `/me/tests/${testId}/attempt`, 'start', {
    tab,
    holdsPaper: true,
  });
  if (!started) return;

  const firstActionAt = new Date().toISOString();
  const saves = Math.max(1, Math.floor(SITTING_SEC / AUTOSAVE_SEC));
  const perSave = Math.ceil(setup.questions.length / saves);
  let cursor = 0;
  let revision = 0;

  for (let round = 0; round < saves; round += 1) {
    sleep(AUTOSAVE_SEC);
    revision += 1;
    const answers = answerBatch(setup.questions, cursor, perSave, firstActionAt);
    cursor += answers.length;
    const ack = api.read('PATCH', `/me/attempts/${started.id}/state`, 'autosave', {
      revision,
      answers,
      tab,
    });
    // A 200 on a stale batch is not a save, and the ack's own flag is the only thing that says so.
    if (ack) savesApplied.add(ack.applied);
  }

  const last = {
    revision: revision + 1,
    answers: answerBatch(setup.questions, cursor, perSave, firstActionAt),
  };
  api.read('POST', `/me/attempts/${started.id}/submit`, 'submit', { tab, last });
}

// ---- Tier 2: the minutes after submit --------------------------------------

export function aftermath() {
  const tokens = login(myAccount(), TIERS.AFTERMATH, 'warmup_login');
  if (!tokens) return;
  const api = client(tokens.accessToken, TIERS.AFTERMATH);

  const trend = api.read('GET', '/me/performance', 'performance');
  api.fire('GET', '/me/overview', 'overview');
  api.fire('GET', '/me/performance/days', 'performance_days');

  const sat = trend && trend.sittings && trend.sittings.length ? trend.sittings[0] : null;
  if (!sat) return;

  api.fire('GET', `/me/attempts/${sat.attemptId}/scorecard`, 'scorecard');
  api.fire('GET', `/me/attempts/${sat.attemptId}/solutions`, 'solutions');
  api.fire('GET', `/me/leaderboard?testId=${sat.testId}`, 'leaderboard');
}

// ---- Tier 3: the login herd ------------------------------------------------

export function loginHerd() {
  const tokens = login(myAccount(), TIERS.LOGIN, 'student_login');
  if (!tokens) return;

  const api = client(tokens.accessToken, TIERS.LOGIN);
  api.fire('GET', '/me/catalog', 'catalog');
  client(null, TIERS.LOGIN).fire('POST', '/auth/refresh', 'refresh', {
    refreshToken: tokens.refreshToken,
  });
}

// ---- Tier 4: admins watching the event -------------------------------------

export function admin(setup) {
  if (!__ENV.ADMIN_TOKEN) return;
  const api = client(__ENV.ADMIN_TOKEN, TIERS.ADMIN);

  api.fire('GET', '/admin/questions?page=1&pageSize=25&q=current', 'bank_search');
  api.fire('GET', '/admin/tests?page=1&pageSize=25', 'tests_list');
  api.fire('GET', '/admin/live-ops/tests', 'live_ops_tests');

  if (!setup.testId) return;
  api.fire('GET', `/admin/live-ops/tests/${setup.testId}`, 'live_ops_board');
  api.fire('GET', `/admin/tests/${setup.testId}/analytics`, 'test_analytics');
}

// ---- Tier 5: what the edge serves ------------------------------------------

export function assets() {
  for (const path of (__ENV.ASSET_PATHS || '/index.html').split(',')) {
    const res = http.get(`${CDN}${path.trim()}`, {
      tags: { tier: TIERS.ASSETS, op: 'asset' },
      timeout: '30s',
    });
    check(res, { 'asset 2xx': (r) => r.status >= 200 && r.status < 300 });
  }
}

// ---- Scenarios -------------------------------------------------------------

const arrival = (name, rate, perVu) => ({
  executor: 'constant-arrival-rate',
  exec: name,
  rate,
  timeUnit: '1s',
  duration: DURATION,
  preAllocatedVUs: Math.max(1, rate * perVu),
  maxVUs: Math.max(2, rate * perVu * 4),
});

const SCENARIOS = {
  [TIERS.SITTING]: {
    executor: 'per-vu-iterations',
    exec: 'sitting',
    vus: CANDIDATES,
    iterations: 1,
    maxDuration: `${OPEN_WINDOW_SEC + SITTING_SEC + 300}s`,
  },
  [TIERS.AFTERMATH]: arrival('aftermath', AFTERMATH_RPS, 10),
  [TIERS.LOGIN]: {
    executor: 'ramping-arrival-rate',
    exec: 'loginHerd',
    startRate: 1,
    timeUnit: '1s',
    preAllocatedVUs: LOGIN_PEAK_RPS * 5,
    maxVUs: LOGIN_PEAK_RPS * 20,
    stages: [
      { target: LOGIN_PEAK_RPS, duration: '1m' },
      { target: LOGIN_PEAK_RPS, duration: '3m' },
      { target: 0, duration: '30s' },
    ],
  },
  [TIERS.ADMIN]: arrival('admin', ADMIN_RPS, 10),
  [TIERS.ASSETS]: arrival('assets', ASSET_RPS, 5),
};

function selected() {
  if (TIER === 'all') return SCENARIOS;
  const picked = {};
  for (const name of TIER.split(',')) {
    const wanted = name.trim();
    if (SCENARIOS[wanted]) picked[wanted] = SCENARIOS[wanted];
  }
  return picked;
}

/** Budgets, not guesses: the paper gives up on a save at 15 s and a submit at 10 s, and the API refuses at 8 s. */
export const options = {
  scenarios: selected(),
  discardResponseBodies: true,
  thresholds: {
    http_req_failed: ['rate<0.01'],
    autosave_applied: ['rate>0.99'],
    'http_req_duration{op:autosave}': ['p(95)<500'],
    'http_req_duration{op:submit}': ['p(95)<2000'],
    'http_req_duration{op:start}': ['p(95)<2000'],
    'http_req_duration{op:test_paper}': ['p(95)<3000'],
    'http_req_duration{op:brief}': ['p(95)<800'],
    'http_req_duration{op:catalog}': ['p(95)<500'],
    'http_req_duration{op:student_login}': ['p(95)<1000'],
    'http_req_duration{op:refresh}': ['p(95)<500'],
    'http_req_duration{op:scorecard}': ['p(95)<1000'],
    'http_req_duration{op:solutions}': ['p(95)<1000'],
    'http_req_duration{op:leaderboard}': ['p(95)<1000'],
    'http_req_duration{op:performance}': ['p(95)<1000'],
    'http_req_duration{op:bank_search}': ['p(95)<3000'],
    'http_req_duration{op:live_ops_board}': ['p(95)<3000'],
    'http_req_duration{op:test_analytics}': ['p(95)<3000'],
    'http_req_duration{op:asset}': ['p(95)<1000'],
  },
};

/** The shared paper is one fetch for the whole run: every candidate sits the same question set. */
export function setup() {
  const health = http.get(`${BASE}/health`);
  if (health.status !== 200) {
    exec.test.abort(`${BASE}/health answered ${health.status}; nothing to load.`);
  }
  // Only the sitting answers questions, so no other tier is held up by needing an account that can.
  if (!selected()[TIERS.SITTING]) return { testId: __ENV.TEST_ID || null, questions: [] };

  const tokens = login(ACCOUNTS[0], TIERS.SETUP, 'warmup_login');
  if (!tokens) exec.test.abort('The first account could not sign in; check ACCOUNTS and the PIN.');
  const api = client(tokens.accessToken, TIERS.SETUP);

  let testId = __ENV.TEST_ID;
  if (!testId) {
    const catalog = api.read('GET', '/me/catalog', 'catalog');
    testId = catalog ? startableTest(catalog) : null;
  }
  if (!testId) exec.test.abort('No startable test; pass one with -e TEST_ID=...');

  const paper = api.read('GET', `/me/tests/${testId}/paper`, 'test_paper');
  if (!paper) exec.test.abort(`The paper for ${testId} did not build; nothing to answer.`);

  return {
    testId,
    questions: paper.questions.map((question) => ({
      q: question.questionId,
      o: question.options.map((option) => option.id),
    })),
  };
}
