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
