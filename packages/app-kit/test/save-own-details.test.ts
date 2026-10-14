import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type QueryClient } from '@tanstack/react-query';
import { AppException, ErrorCodes, type Me, type UpdateMeInput } from '@iace/contracts';
import { type AppApiClient } from '../src/api-client';
import { saveOwnDetails } from '../src/student-queries';

const me = (fullName: string, updatedAt: string) => ({ fullName, updatedAt }) as unknown as Me;
const values = { fullName: 'Asha' } as UpdateMeInput;

function harness(refused: boolean, reread: Me) {
  const stamps: unknown[] = [];
  const api = {
    me: {
      update: async (body: { expectedUpdatedAt?: string }) => {
        stamps.push(body.expectedUpdatedAt);
        if (refused && stamps.length === 1) {
          throw new AppException(ErrorCodes.CONFLICT, 'moved');
        }
        return 'saved';
      },
      profile: async () => reread,
    },
  } as unknown as AppApiClient;
  const queryClient = { fetchQuery: (o: { queryFn: () => Promise<Me> }) => o.queryFn() };
  return { api, queryClient: queryClient as unknown as QueryClient, stamps };
}

describe('saveOwnDetails — a save that races an enrolment', () => {
  it('retries on the newest stamp when none of the student own fields moved', async () => {
    const opened = me('Asha', 't1');
    const h = harness(true, me('Asha', 't2'));
    assert.equal(await saveOwnDetails(h.api, h.queryClient, opened, opened, values), 'saved');
    assert.deepEqual(h.stamps, ['t1', 't2']);
  });

  it('gives up when a field they are editing moved elsewhere', async () => {
    const opened = me('Asha', 't1');
    const h = harness(true, me('Someone else', 't2'));
    await assert.rejects(saveOwnDetails(h.api, h.queryClient, opened, opened, values), (e) =>
      AppException.is(e),
    );
    assert.equal(h.stamps.length, 1);
  });
});
