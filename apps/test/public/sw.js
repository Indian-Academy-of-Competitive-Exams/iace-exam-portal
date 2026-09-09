/**
 * The student app's service worker. Two jobs and no more: keep the shell openable when the
 * network is not there, and render a push. It caches the built, content-hashed assets and the
 * shell document only — never an API response, because those carry a sitting's answers and a
 * paper's key, and an exam that ran from a stale cache would be a result nobody could defend.
 */

const CACHE = 'iace-shell-v1';

const SHELL = '/';

/** Vite's hashed build output. The name changes on every build, so a hit is never stale. */
const ASSET_PREFIX = '/assets/';

/** An exam is never served from cache: offline, it must fail rather than look like it opened. */
const EXAM_PATH = /^\/tests\/[^/]+\/exam$/;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map(dropCache)))
      .then(() => self.clients.claim()),
  );
});

// No skipWaiting: a new bundle swapped under a sitting in progress is worse than a stale tab.

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(shellFor(request, url));
    return;
  }
  if (url.pathname.startsWith(ASSET_PREFIX)) event.respondWith(cacheFirst(request));
});

self.addEventListener('push', (event) => {
  const message = readPush(event.data);

  event.waitUntil(
    self.registration.showNotification(message.title, {
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: message.notificationId,
      data: { url: message.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? SHELL;

  event.waitUntil(openInApp(target));
});

/** The document, from the network first — a cached shell is the fallback, never the default. */
async function shellFor(request, url) {
  try {
    return await fetch(request);
  } catch (error) {
    if (EXAM_PATH.test(url.pathname)) throw error;

    const shell = await caches.match(SHELL);
    if (!shell) throw error;
    return shell;
  }
}

/** Safe only because the name carries the content hash: a changed asset is a different URL. */
async function cacheFirst(request) {
  const held = await caches.match(request);
  if (held) return held;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

function dropCache(name) {
  return caches.delete(name);
}

/** userVisibleOnly means something must always be shown, so a payload we cannot read still is. */
function readPush(data) {
  const fallback = { title: 'IACE', url: SHELL, notificationId: undefined };
  if (!data) return fallback;

  try {
    const payload = data.json();
    return {
      title: typeof payload.title === 'string' ? payload.title : fallback.title,
      url: typeof payload.url === 'string' ? payload.url : fallback.url,
      notificationId:
        typeof payload.notificationId === 'string' ? payload.notificationId : undefined,
    };
  } catch {
    return fallback;
  }
}

/** A tab already open is the one to bring forward; opening a second is how you lose a sitting. */
async function openInApp(path) {
  const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const here = open.find((client) => new URL(client.url).origin === self.location.origin);

  if (here) {
    await here.focus();
    if ('navigate' in here) await here.navigate(path);
    return;
  }
  await self.clients.openWindow(path);
}
