import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { useEffect } from 'react';
import { QueryClient, QueryClientProvider, onlineManager, useQuery } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import {
  AppException,
  ErrorCodes,
  type AuthIdentity,
  type AuthSessionResponse,
} from '@iace/contracts';
import { createBrowserTokenStore } from '../browser';
import { createAuth, SIGN_OUT_WAIT_MS, type AuthState } from '../src/create-auth';
import { type SignOutReason, type SignOutSignal } from '../src/sign-out-signal';
import { createTokenStore, type KeyValueStorage, type TokenStore } from '../src/token-store';
import { fakeStorage } from './support/fake-storage';

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
});

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

const NO_SIGNAL = { emit: () => undefined, subscribe: () => () => undefined };
const refusal = (httpStatus: number) => new AppException(ErrorCodes.INTERNAL, 'x', { httpStatus });

/** A session whose identity read the test answers, and the state a screen is handed for it. */
function sessionAnswering(
  me: () => Promise<AuthIdentity>,
  store: TokenStore,
  logout: () => Promise<void> = () => Promise.resolve(),
  signOutSignal: SignOutSignal = NO_SIGNAL,
) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const auth = createAuth<AuthIdentity>({
    actor: 'STUDENT',
    queryKey: ['auth', 'me'],
    tokenStore: store,
    signOutSignal,
    endpoints: { me, logout },
  });
  let state: AuthState<AuthIdentity> | undefined;
  function Probe() {
    state = auth.useAuth();
    return null;
  }
  render(
    <QueryClientProvider client={client}>
      <auth.AuthProvider>
        <Probe />
      </auth.AuthProvider>
    </QueryClientProvider>,
  );
  return () => {
    assert.ok(state);
    return state;
  };
}

function heldToken(key: string): TokenStore {
  const store = createTokenStore(key, fakeStorage());
  store.set({ accessToken: 'a', refreshToken: 'r', expiresInSec: 900 });
  return store;
}

describe('a session whose server does not answer', () => {
  /** The failure this prevents: a student reloading mid-paper while the API is down, sent to sign in with a good token. */
  it('is unreachable rather than signed out, and opens once a retry is answered', async () => {
    const store = heldToken('iace.test.down');
    let up = false;
    const read = sessionAnswering(
      () =>
        up ? Promise.resolve({ actor: 'STUDENT' } as AuthIdentity) : Promise.reject(refusal(0)),
      store,
    );

    // The one retry is spread over a second or two, so the wait covers the widest draw.
    await waitFor(() => assert.equal(read().isUnreachable, true), { timeout: 3000 });
    assert.equal(read().isLoading, false);
    assert.notEqual(store.get(), null);

    up = true;
    act(() => read().retry());

    await waitFor(() => assert.equal(read().identity?.actor, 'STUDENT'));
    assert.equal(read().isUnreachable, false);
  });

  it('is unreachable while the browser is offline, and opens by itself once back online', async () => {
    onlineManager.setOnline(false);
    const read = sessionAnswering(
      () => Promise.resolve({ actor: 'STUDENT' } as AuthIdentity),
      heldToken('iace.test.offline'),
    );

    assert.equal(read().isUnreachable, true);
    assert.equal(read().isLoading, false);

    act(() => onlineManager.setOnline(true));

    await waitFor(() => assert.equal(read().identity?.actor, 'STUDENT'));
    assert.equal(read().isUnreachable, false);
  });

  it('is signed out, not unreachable, when the server refuses the token', async () => {
    let asked = 0;
    const read = sessionAnswering(() => {
      asked += 1;
      return Promise.reject(refusal(403));
    }, heldToken('iace.test.refused'));

    await waitFor(() => assert.equal(asked, 1));
    await waitFor(() => assert.equal(read().isLoading, false));

    assert.equal(read().identity, null);
    assert.equal(read().isUnreachable, false);
  });
});

const student = () => Promise.resolve({ actor: 'STUDENT' } as AuthIdentity);
const unanswered = () => new Promise<never>(() => undefined);

describe('signing out', () => {
  /** The failure this prevents: a phone with no signal left on a signed-in screen after Sign out was confirmed. */
  it('clears the device once the wait runs out on a server that never answers', async (t) => {
    // Mocked before anything mounts: a real timer set earlier could not be cleared under the mock.
    mock.timers.enable({ apis: ['setTimeout'] });
    t.after(() => mock.timers.reset());
    const store = heldToken('iace.test.hung');
    const read = sessionAnswering(unanswered, store, unanswered);

    const signedOut = read().signOut();
    await act(async () => {
      await Promise.resolve();
    });
    assert.notEqual(store.get(), null, 'the server is given its chance to answer first');

    await act(async () => {
      mock.timers.tick(SIGN_OUT_WAIT_MS);
      await signedOut;
    });

    assert.equal(store.get(), null);
    assert.equal(read().isLoading, false);
  });

  it('clears the device when the server refuses the sign-out', async () => {
    const store = heldToken('iace.test.refused-out');
    const read = sessionAnswering(student, store, () => Promise.reject(refusal(401)));
    await waitFor(() => assert.equal(read().identity?.actor, 'STUDENT'));

    await act(() => read().signOut());

    assert.equal(store.get(), null);
    assert.equal(read().identity, null);
  });
});

const tokens = { accessToken: 'a', refreshToken: 'r', expiresInSec: 900 };
const heardEmptied = (key: string) => window.dispatchEvent(new StorageEvent('storage', { key }));

describe('a session another browser replaced', () => {
  /** The failure this prevents: the tab the server did not tell landing on sign-in with no word of why. */
  it('says why in a tab that only heard the store empty', async () => {
    const KEY = 'iace.test.replaced';
    const store = createBrowserTokenStore(KEY);
    store.set(tokens);
    const read = sessionAnswering(student, store);
    await waitFor(() => assert.equal(read().identity?.actor, 'STUDENT'));

    act(() => {
      createBrowserTokenStore(KEY).clear({ replacedBy: 'MOBILE' });
      heardEmptied(KEY);
    });

    assert.equal(read().identity, null);
    assert.deepEqual(read().signedOutReason, { replacedBy: 'MOBILE' });
  });

  /** A tab that missed the write learns from its own next request, which has no token left to be told why. */
  it('says why in a tab whose own request found the store already emptied', async () => {
    const KEY = 'iace.test.late';
    const store = createBrowserTokenStore(KEY);
    store.set(tokens);
    const heard = new Set<(reason?: SignOutReason) => void>();
    const signal: SignOutSignal = {
      emit: (reason) => heard.forEach((handler) => handler(reason)),
      subscribe: (handler) => {
        heard.add(handler);
        return () => heard.delete(handler);
      },
    };
    const read = sessionAnswering(student, store, undefined, signal);
    await waitFor(() => assert.equal(read().identity?.actor, 'STUDENT'));

    createBrowserTokenStore(KEY).clear({ replacedBy: 'MOBILE' });
    act(() => signal.emit());

    assert.equal(read().identity, null);
    assert.deepEqual(read().signedOutReason, { replacedBy: 'MOBILE' });
  });

  it('still says why after a reload, and stops once someone signs in', () => {
    const KEY = 'iace.test.reloaded';
    createBrowserTokenStore(KEY).clear({ replacedBy: 'WEB' });

    const read = sessionAnswering(student, createBrowserTokenStore(KEY));
    assert.deepEqual(read().signedOutReason, { replacedBy: 'WEB' });

    act(() => read().signIn({ tokens, identity: { actor: 'STUDENT' } } as AuthSessionResponse));

    assert.equal(read().signedOutReason, null);
    assert.equal(createBrowserTokenStore(KEY).endedBy?.(), null);
  });

  it('gives no reason for a sign-out made by choice in another tab', async () => {
    const KEY = 'iace.test.chosen';
    const store = createBrowserTokenStore(KEY);
    store.set(tokens);
    const read = sessionAnswering(student, store);
    await waitFor(() => assert.equal(read().identity?.actor, 'STUDENT'));

    act(() => {
      createBrowserTokenStore(KEY).clear();
      heardEmptied(KEY);
    });

    assert.equal(read().identity, null);
    assert.equal(read().signedOutReason, null);
  });
});

const PEOPLE: Record<string, string> = { a: 'one', renewed: 'one', b: 'two' };
const ROWS = ['rows'];

/** This tab and another on one storage: `elsewhere` is the other tab writing, then this one hearing of it. */
function twoTabs(held: string | null) {
  const KEY = 'iace.test.tabs';
  const storage = fakeStorage();
  const counts = { written: 0, asked: 0, loggedOut: 0, mounted: 0 };
  const counted: KeyValueStorage = {
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => {
      counts.written += 1;
      storage.setItem(key, value);
    },
    removeItem: (key) => {
      counts.written += 1;
      storage.removeItem(key);
    },
  };
  const heard = new Set<() => void>();
  const store: TokenStore = {
    ...createTokenStore(KEY, counted),
    subscribe: (onChange) => {
      heard.add(onChange);
      return () => heard.delete(onChange);
    },
  };
  const other = createTokenStore(KEY, storage);
  const hold = (accessToken: string | null) =>
    accessToken === null
      ? other.clear()
      : other.set({ accessToken, refreshToken: 'r', expiresInSec: 900 });
  hold(held);

  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const auth = createAuth<AuthIdentity>({
    actor: 'STUDENT',
    queryKey: ['auth', 'me'],
    tokenStore: store,
    signOutSignal: NO_SIGNAL,
    endpoints: {
      me: () => {
        counts.asked += 1;
        const id = PEOPLE[store.get()?.accessToken ?? ''];
        return Promise.resolve({ actor: 'STUDENT', id } as AuthIdentity);
      },
      logout: () => {
        counts.loggedOut += 1;
        return Promise.resolve();
      },
    },
  });

  let who: string | null = null;
  const drawn: Array<{ who: string | null; rows: string | undefined }> = [];
  /** A list that never reads the session and never asks twice: only a remount onto an emptied cache changes it. */
  function Rows() {
    const rows = useQuery({
      queryKey: ROWS,
      queryFn: () => Promise.resolve(`rows of ${store.get()?.accessToken}`),
      staleTime: Infinity,
    });
    useEffect(() => {
      counts.mounted += 1;
    }, []);
    drawn.push({ who, rows: rows.data });
    return null;
  }
  // One element for every render, as a route's is: React skips a child it was handed unchanged.
  const page = <Rows />;
  function Screen() {
    who = auth.useAuth().identity?.id ?? null;
    return who === null ? null : page;
  }
  render(
    <QueryClientProvider client={client}>
      <auth.AuthProvider>
        <Screen />
      </auth.AuthProvider>
    </QueryClientProvider>,
  );

  return {
    client,
    counts,
    drawn,
    now: () => ({ who, rows: who === null ? undefined : drawn.at(-1)?.rows }),
    elsewhere: (accessToken: string | null) => {
      hold(accessToken);
      heard.forEach((onChange) => onChange());
    },
  };
}

describe('a session another tab changes', () => {
  it('signs this tab out with nothing cached, and neither writes the store nor calls the server', async () => {
    const tab = twoTabs('a');
    await waitFor(() => assert.deepEqual(tab.now(), { who: 'one', rows: 'rows of a' }));

    act(() => tab.elsewhere(null));

    assert.equal(tab.now().who, null);
    assert.equal(tab.client.getQueryData(ROWS), undefined);
    assert.equal(tab.counts.written, 0, 'a write here could erase the session the other tab holds');
    assert.equal(tab.counts.loggedOut, 0);
    tab.client.clear();
  });

  /** The failure this prevents: one admin on screen while every request acts as another. */
  it('shows who the other tab signed in as, with none of the last person left on screen', async () => {
    const tab = twoTabs('a');
    await waitFor(() => assert.deepEqual(tab.now(), { who: 'one', rows: 'rows of a' }));

    act(() => tab.elsewhere('b'));

    await waitFor(() => assert.deepEqual(tab.now(), { who: 'two', rows: 'rows of b' }));
    assert.deepEqual(
      tab.drawn.filter((screen) => screen.who === 'two' && screen.rows === 'rows of a'),
      [],
    );
    assert.equal(tab.counts.written, 0);
    tab.client.clear();
  });

  /** A tab woken late hears the sign-out and the sign-in at once, the store already holding the second. */
  it('remounts the screen once however many writes it hears of one change', async () => {
    const tab = twoTabs('a');
    await waitFor(() => assert.deepEqual(tab.now(), { who: 'one', rows: 'rows of a' }));

    act(() => {
      tab.elsewhere('b');
      tab.elsewhere('b');
    });

    await waitFor(() => assert.deepEqual(tab.now(), { who: 'two', rows: 'rows of b' }));
    assert.equal(tab.counts.mounted, 2);
    tab.client.clear();
  });

  /** A token is renewed every few minutes: that must not cost the other tabs what they have on screen. */
  it('leaves the screen as it is when the other tab only renewed the token', async () => {
    const tab = twoTabs('a');
    await waitFor(() => assert.deepEqual(tab.now(), { who: 'one', rows: 'rows of a' }));
    const asked = tab.counts.asked;

    act(() => tab.elsewhere('renewed'));

    await waitFor(() => assert.equal(tab.counts.asked, asked + 1));
    assert.deepEqual(tab.now(), { who: 'one', rows: 'rows of a' });
    assert.equal(tab.counts.mounted, 1);
    assert.equal(tab.counts.written, 0);
    tab.client.clear();
  });

  it('takes up the session the other tab signed in to', async () => {
    const tab = twoTabs(null);
    assert.equal(tab.now().who, null);

    act(() => tab.elsewhere('b'));

    await waitFor(() => assert.deepEqual(tab.now(), { who: 'two', rows: 'rows of b' }));
    assert.equal(tab.counts.written, 0);
    tab.client.clear();
  });
});
