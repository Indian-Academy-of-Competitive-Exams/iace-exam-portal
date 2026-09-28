import test from 'node:test';
import assert from 'node:assert/strict';
import { AppException, ErrorCodes } from '@iace/contracts';
import { createAppQueryClient } from '../src/query-client';

function recordingClient() {
  const errors: string[] = [];
  const client = createAppQueryClient({
    notify: { error: (message) => errors.push(message), success: () => undefined },
  });
  // No retry, and nothing kept once settled: a 5-minute cleanup timer would hold the test process open.
  client.setDefaultOptions({ queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } });
  return { client, errors };
}

test('a replaced session is not announced by every request it cut short', async () => {
  const { client, errors } = recordingClient();
  const replaced = new AppException(ErrorCodes.SESSION_REPLACED);

  await assert.rejects(
    client.fetchQuery({ queryKey: ['a'], queryFn: () => Promise.reject(replaced) }),
  );
  await assert.rejects(
    client
      .getMutationCache()
      .build(client, { mutationFn: () => Promise.reject(replaced) })
      .execute(undefined),
  );

  assert.deepEqual(errors, []);
});

test('any other failure is still announced', async () => {
  const { client, errors } = recordingClient();
  const refused = new AppException(ErrorCodes.CONFLICT, 'That already exists');

  await assert.rejects(
    client.fetchQuery({ queryKey: ['b'], queryFn: () => Promise.reject(refused) }),
  );

  assert.deepEqual(errors, ['That already exists']);
});

/** The failure this prevents: every expected refusal costing a second request before the screen can draw it. */
test('a refusal is answered once; a request that never landed is asked again', () => {
  const retry = createAppQueryClient().getDefaultOptions().queries?.retry as (
    failures: number,
    error: unknown,
  ) => boolean;
  const offline = new AppException(ErrorCodes.INTERNAL, 'offline', { httpStatus: 0 });

  assert.equal(retry(0, new AppException(ErrorCodes.CONFLICT)), false);
  assert.equal(retry(0, new AppException(ErrorCodes.FORBIDDEN)), false);
  assert.equal(retry(0, offline), true);
  assert.equal(retry(0, new AppException(ErrorCodes.RATE_LIMITED)), true);
  assert.equal(retry(1, offline), false, 'still only once');
});

test('a refusal the screen draws itself is not announced over it; any other failure still is', async () => {
  const { client, errors } = recordingClient();
  const meta = { silent: (error: unknown) => AppException.is(error) && error.httpStatus === 409 };

  await assert.rejects(
    client.fetchQuery({
      queryKey: ['c'],
      queryFn: () => Promise.reject(new AppException(ErrorCodes.CONFLICT, 'Marking pending')),
      meta,
    }),
  );
  await assert.rejects(
    client.fetchQuery({
      queryKey: ['d'],
      queryFn: () => Promise.reject(new AppException(ErrorCodes.INTERNAL, 'Server down')),
      meta,
    }),
  );

  assert.deepEqual(errors, ['Server down']);
});
