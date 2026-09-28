import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render } from '@testing-library/react';
import { type AuthIdentity } from '@iace/contracts';
import { createAuth } from '../src/create-auth';
import { createTokenStore } from '../src/token-store';
import { fakeStorage } from './support/fake-storage';

afterEach(cleanup);

const tokenStore = createTokenStore('iace.test.auth', fakeStorage());

const { AuthProvider, useAuth } = createAuth<AuthIdentity>({
  actor: 'STUDENT',
  queryKey: ['auth', 'me'],
  tokenStore,
  signOutSignal: { emit: () => undefined, subscribe: () => () => undefined },
  endpoints: { me: () => new Promise(() => undefined), logout: () => Promise.resolve() },
});

describe('createAuth', () => {
  /** A lab machine or a family phone: the next student must not open onto this one's results. */
  it('leaves nothing of the last session in the cache', async () => {
    // Never collected, so only a sign-out can empty it; Infinity schedules no timer to hang the run.
    const client = new QueryClient({
      defaultOptions: { queries: { gcTime: Infinity, retry: false } },
    });
    client.setQueryData(['me', 'catalog'], { tests: ['theirs'] });
    tokenStore.set({ accessToken: 'a', refreshToken: 'r', expiresInSec: 900 });
    let signOut: () => Promise<void> = () => Promise.resolve();
    function Probe() {
      signOut = useAuth().signOut;
      return null;
    }
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await act(() => signOut());

    assert.equal(client.getQueryData(['me', 'catalog']), undefined);
    assert.equal(tokenStore.get(), null);
    client.clear();
  });
});
