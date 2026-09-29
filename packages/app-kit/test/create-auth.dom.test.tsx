import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import {
  AppException,
  ErrorCodes,
  type AuthIdentity,
  type AuthSessionResponse,
} from '@iace/contracts';
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

  /** A push target is bound to one session, so a PIN change's new session must claim it as a sign-in does. */
  it('tells the app of every sign-in, including a session swapped in place', () => {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    let told = 0;
    const hooked = createAuth<AuthIdentity>({
      actor: 'STUDENT',
      queryKey: ['auth', 'me'],
      tokenStore: createTokenStore('iace.test.hook', fakeStorage()),
      signOutSignal: { emit: () => undefined, subscribe: () => () => undefined },
      endpoints: { me: () => new Promise(() => undefined), logout: () => Promise.resolve() },
      onSignedIn: () => (told += 1),
    });
    let signIn: (session: AuthSessionResponse) => void = () => undefined;
    function Probe() {
      signIn = hooked.useAuth().signIn;
      return null;
    }
    render(
      <QueryClientProvider client={client}>
        <hooked.AuthProvider>
          <Probe />
        </hooked.AuthProvider>
      </QueryClientProvider>,
    );
    const session = (accessToken: string) =>
      ({
        tokens: { accessToken, refreshToken: 'r', expiresInSec: 900 },
        identity: { actor: 'STUDENT' },
      }) as AuthSessionResponse;

    act(() => signIn(session('signed-in')));
    act(() => signIn(session('after-pin-change')));

    assert.equal(told, 2);
    client.clear();
  });

  /** The failure this prevents: a blip at boot sending a student with a good token to sign in again. */
  it('asks for the identity again when the first read never got an answer', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { gcTime: Infinity, retryDelay: 0 } },
    });
    const store = createTokenStore('iace.test.blip', fakeStorage());
    store.set({ accessToken: 'a', refreshToken: 'r', expiresInSec: 900 });
    let asked = 0;
    const blip = createAuth<AuthIdentity>({
      actor: 'STUDENT',
      queryKey: ['auth', 'me'],
      tokenStore: store,
      signOutSignal: { emit: () => undefined, subscribe: () => () => undefined },
      endpoints: {
        me: () => {
          asked += 1;
          if (asked === 1) {
            return Promise.reject(new AppException(ErrorCodes.INTERNAL, 'x', { httpStatus: 503 }));
          }
          return Promise.resolve({ actor: 'STUDENT' } as AuthIdentity);
        },
        logout: () => Promise.resolve(),
      },
    });
    const seen: Array<AuthIdentity | null> = [];
    function Probe() {
      seen.push(blip.useAuth().identity);
      return null;
    }
    render(
      <QueryClientProvider client={client}>
        <blip.AuthProvider>
          <Probe />
        </blip.AuthProvider>
      </QueryClientProvider>,
    );

    // The retry is spread over a second or two, so the wait covers the widest draw.
    await waitFor(() => assert.equal(seen.at(-1)?.actor, 'STUDENT'), { timeout: 3000 });
    assert.equal(asked, 2);
    client.clear();
  });
});
