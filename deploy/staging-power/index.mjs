// The staging power switch: serves the page, and starts, stops and reports on staging's three resources.
import { readFileSync } from 'node:fs';
import {
  CreateTagsCommand,
  DeleteTagsCommand,
  DescribeInstancesCommand,
  EC2Client,
  StartInstancesCommand,
  StopInstancesCommand,
} from '@aws-sdk/client-ec2';
import {
  DescribeDBInstancesCommand,
  RDSClient,
  StartDBInstanceCommand,
  StopDBInstanceCommand,
} from '@aws-sdk/client-rds';
import {
  GetScheduleCommand,
  SchedulerClient,
  UpdateScheduleCommand,
} from '@aws-sdk/client-scheduler';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import {
  ACTIONS,
  CHECKIN_TAG_PREFIX,
  checkedIn,
  cleanName,
  othersCheckedIn,
  parseAutoOff,
  resourcesToChange,
  sameSecret,
  scheduleFor,
} from './logic.mjs';

const {
  API_INSTANCE_ID,
  VALKEY_INSTANCE_ID,
  DB_INSTANCE_ID,
  API_HEALTH_URL,
  EXAMS_URL,
  ADMIN_URL,
  PASSCODE_PARAM,
  AUTO_OFF_SCHEDULE,
} = process.env;
const MANAGE_SHARED = process.env.MANAGE_SHARED === 'true';
const PAGE = readFileSync(new URL('./page.html', import.meta.url), 'utf8');
const HEALTH_TIMEOUT_MS = 3000;
const RUNNING = 'running';
const ERRORS = { PASSCODE: 'passcode', NAME: 'name', SETTING: 'setting', OTHERS: 'others' };

const ec2 = new EC2Client();
const rds = new RDSClient();
const ssm = new SSMClient();
const scheduler = new SchedulerClient();

const START = {
  api: () => ec2.send(new StartInstancesCommand({ InstanceIds: [API_INSTANCE_ID] })),
  valkey: () => ec2.send(new StartInstancesCommand({ InstanceIds: [VALKEY_INSTANCE_ID] })),
  db: () => rds.send(new StartDBInstanceCommand({ DBInstanceIdentifier: DB_INSTANCE_ID })),
};
const STOP = {
  api: () => ec2.send(new StopInstancesCommand({ InstanceIds: [API_INSTANCE_ID] })),
  valkey: () => ec2.send(new StopInstancesCommand({ InstanceIds: [VALKEY_INSTANCE_ID] })),
  db: () => rds.send(new StopDBInstanceCommand({ DBInstanceIdentifier: DB_INSTANCE_ID })),
};

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

let passcode;
async function passcodeMatches(given) {
  passcode ??= (
    await ssm.send(new GetParameterCommand({ Name: PASSCODE_PARAM, WithDecryption: true }))
  ).Parameter.Value;
  return sameSecret(given, passcode);
}

async function probeApi() {
  try {
    const response = await fetch(API_HEALTH_URL, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (response.ok) return { ready: true, reason: null };
    const body = await response.json().catch(() => null);
    return { ready: false, reason: body?.error?.message ?? `HTTP ${response.status}` };
  } catch {
    return { ready: false, reason: null };
  }
}

async function readState() {
  const [instances, databases, schedule, api] = await Promise.all([
    ec2.send(new DescribeInstancesCommand({ InstanceIds: [API_INSTANCE_ID, VALKEY_INSTANCE_ID] })),
    rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: DB_INSTANCE_ID })),
    scheduler.send(new GetScheduleCommand({ Name: AUTO_OFF_SCHEDULE })),
    probeApi(),
  ]);
  const byId = Object.fromEntries(
    instances.Reservations.flatMap((reservation) => reservation.Instances).map((instance) => [
      instance.InstanceId,
      instance,
    ]),
  );
  const apiBox = byId[API_INSTANCE_ID];
  const valkeyBox = byId[VALKEY_INSTANCE_ID];
  return {
    apiBox,
    valkeyBox,
    schedule,
    api,
    states: {
      api: apiBox.State.Name,
      valkey: valkeyBox.State.Name,
      db: databases.DBInstances[0].DBInstanceStatus,
    },
    checkedIn: checkedIn(apiBox.Tags, Date.now()),
    autoOff: JSON.parse(schedule.Target.Input).autoOff,
  };
}

const boxView = (box) => ({
  state: box.State.Name,
  since: box.State.Name === RUNNING ? box.LaunchTime.toISOString() : null,
});

function view(state) {
  const timedAt = /^at\((.+)\)$/.exec(state.schedule.ScheduleExpression)?.[1];
  const armed = state.schedule.State === 'ENABLED' && timedAt;
  return {
    manageShared: MANAGE_SHARED,
    resources: {
      api: boxView(state.apiBox),
      valkey: boxView(state.valkeyBox),
      db: { state: state.states.db },
    },
    api: state.api,
    checkedIn: state.checkedIn,
    autoOff: { ...state.autoOff, firesAt: armed ? `${timedAt}Z` : null },
    links: { exams: EXAMS_URL, admin: ADMIN_URL },
  };
}

async function apply(action, state) {
  const names = resourcesToChange(action, state.states, MANAGE_SHARED);
  const run = action === ACTIONS.ON ? START : STOP;
  await Promise.all(names.map((name) => run[name]()));
  return names;
}

async function saveAutoOff(setting, apiRunning, schedule) {
  const next = scheduleFor(setting, apiRunning, Date.now());
  await scheduler.send(
    new UpdateScheduleCommand({
      Name: schedule.Name,
      GroupName: schedule.GroupName,
      FlexibleTimeWindow: { Mode: 'OFF' },
      ScheduleExpression: next.expression,
      ScheduleExpressionTimezone: next.timezone,
      State: next.enabled ? 'ENABLED' : 'DISABLED',
      Target: {
        Arn: schedule.Target.Arn,
        RoleArn: schedule.Target.RoleArn,
        Input: JSON.stringify({ action: ACTIONS.OFF, autoOff: setting }),
      },
    }),
  );
}

const checkinTag = (name) => `${CHECKIN_TAG_PREFIX}${name}`;

async function checkIn(name) {
  await ec2.send(
    new CreateTagsCommand({
      Resources: [API_INSTANCE_ID],
      Tags: [{ Key: checkinTag(name), Value: new Date().toISOString() }],
    }),
  );
}

async function checkOut(names) {
  if (names.length === 0) return;
  await ec2.send(
    new DeleteTagsCommand({
      Resources: [API_INSTANCE_ID],
      Tags: names.map((name) => ({ Key: checkinTag(name) })),
    }),
  );
}

async function turnOff(state) {
  const changed = await apply(ACTIONS.OFF, state);
  const everyone = (state.apiBox.Tags ?? [])
    .filter((tag) => tag.Key.startsWith(CHECKIN_TAG_PREFIX))
    .map((tag) => tag.Key.slice(CHECKIN_TAG_PREFIX.length));
  await checkOut(everyone);
  await saveAutoOff(state.autoOff, false, state.schedule);
  return changed;
}

async function runScheduled(action) {
  const state = await readState();
  const changed =
    action === ACTIONS.OFF ? await turnOff(state) : await apply(ACTIONS.KEEP_OFF, state);
  console.log(JSON.stringify({ scheduled: action, changed }));
  return { changed };
}

const ROUTES = {
  'GET /status': async () => null,
  'POST /on': async (state, body, name) => {
    if (!name) return json(400, { error: ERRORS.NAME });
    await apply(ACTIONS.ON, state);
    await checkIn(name);
    await saveAutoOff(state.autoOff, true, state.schedule);
    return null;
  },
  'POST /off': async (state, body, name) => {
    const others = othersCheckedIn(state.checkedIn, name);
    if (others.length > 0 && body.force !== true) {
      return json(409, { error: ERRORS.OTHERS, others: others.map((entry) => entry.name) });
    }
    await turnOff(state);
    return null;
  },
  'POST /checkin': async (state, body, name) => {
    if (!name) return json(400, { error: ERRORS.NAME });
    await checkIn(name);
    return null;
  },
  'POST /checkout': async (state, body, name) => {
    if (!name) return json(400, { error: ERRORS.NAME });
    await checkOut([name]);
    return null;
  },
  'POST /auto-off': async (state, body) => {
    const setting = parseAutoOff(body);
    if (!setting) return json(400, { error: ERRORS.SETTING });
    await saveAutoOff(setting, state.states.api === RUNNING, state.schedule);
    return null;
  },
};

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body;
  try {
    return JSON.parse(raw) ?? {};
  } catch {
    return {};
  }
}

export async function handler(event) {
  if (event.action) return runScheduled(event.action);

  const { method, path } = event.requestContext.http;
  if (method === 'GET' && path === '/') {
    return { statusCode: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: PAGE };
  }
  const route = ROUTES[`${method} ${path}`];
  if (!route) return json(404, { error: 'route' });
  if (!(await passcodeMatches(event.headers['x-passcode']))) {
    return json(401, { error: ERRORS.PASSCODE });
  }

  try {
    const body = parseBody(event);
    const refusal = await route(await readState(), body, cleanName(body.name));
    return refusal ?? json(200, view(await readState()));
  } catch (error) {
    console.error(error);
    return json(500, { error: error.name });
  }
}
