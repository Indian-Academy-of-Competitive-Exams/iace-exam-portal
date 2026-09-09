/**
 * The browser half of the PWA: registering the worker, holding on to the install prompt the
 * browser only offers once, and turning a `PushSubscription` into the three strings the API
 * stores. Nothing here asks for permission on its own — a prompt nobody invited is a prompt denied
 * for good, and the notification-preferences screen is where the student asks for it.
 */
import { type PushSubscriptionInput } from '@iace/contracts';

/** Root scope, so the worker controls every route including the one a push deep-links to. */
const SERVICE_WORKER = { url: '/sw.js', scope: '/' } as const;

const STANDALONE_QUERY = '(display-mode: standalone)';

/** What Chrome fires when it would offer an install, and what it wants deferred to a real action. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredInstall: InstallPromptEvent | null = null;

const installListeners = new Set<() => void>();

/** Registered after load, so the worker never competes with the first paint for bandwidth. */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(SERVICE_WORKER.url, { scope: SERVICE_WORKER.scope });
  });
}

/** The browser offers this once and takes it away again, so it is caught before anything can ask. */
export function captureInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstall = event as InstallPromptEvent;
    installListeners.forEach((notify) => notify());
  });

  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    installListeners.forEach((notify) => notify());
  });
}

export function isInstallable(): boolean {
  return deferredInstall !== null;
}

export function isInstalled(): boolean {
  return window.matchMedia(STANDALONE_QUERY).matches;
}

export function onInstallableChange(listener: () => void): () => void {
  installListeners.add(listener);
  return () => installListeners.delete(listener);
}

/** Resolves false when they said no, which is a prompt the browser will not offer again. */
export async function promptInstall(): Promise<boolean> {
  const held = deferredInstall;
  if (!held) return false;

  deferredInstall = null;
  installListeners.forEach((notify) => notify());
  await held.prompt();
  const { outcome } = await held.userChoice;

  return outcome === 'accepted';
}

export function pushIsSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** What this browser already holds, so the screen shows the switch as it really is. */
export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!pushIsSupported()) return null;

  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/** Null when they declined: a refused permission is an answer, not an error to throw at them. */
export async function subscribeToPush(publicKey: string): Promise<PushSubscriptionInput | null> {
  if (!pushIsSupported()) return null;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(publicKey),
  });

  return toSubscriptionInput(subscription);
}

/** Returns the endpoint that was dropped, so the caller can tell the server which row to delete. */
export async function unsubscribeFromPush(): Promise<string | null> {
  const subscription = await currentPushSubscription();
  if (!subscription) return null;

  const { endpoint } = subscription;
  await subscription.unsubscribe();

  return endpoint;
}

export function toSubscriptionInput(subscription: PushSubscription): PushSubscriptionInput | null {
  const json = subscription.toJSON();
  const { p256dh, auth } = json.keys ?? {};
  if (!p256dh || !auth) return null;

  return { endpoint: subscription.endpoint, p256dh, auth, userAgent: navigator.userAgent };
}

/** VAPID keys travel base64url; `applicationServerKey` takes the raw bytes and nothing else. */
function keyBytes(publicKey: string): ArrayBuffer {
  const padded = publicKey.padEnd(publicKey.length + ((4 - (publicKey.length % 4)) % 4), '=');
  const binary = atob(padded.replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.codePointAt(at) ?? 0;

  return bytes.buffer;
}
