import * as React from 'react';
import { AlertTriangle, Check, Info, X } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Transient messages: "Saved", "Added 2 students", "Could not reach the server".
 *
 * The store is a plain module-level subscription rather than React context, so
 * `toast.success(…)` works from anywhere — including a QueryClient callback,
 * which is not inside a component and is precisely where we want to catch every
 * failure once instead of in each form.
 *
 * WHAT DOES NOT BELONG HERE: a message about one field. "Use letters only" in a
 * corner of the screen, while the offending input sits unmarked, makes the
 * reader find it themselves and remember it while they do. Field errors stay on
 * fields — see applyFieldErrors — and this takes what is left.
 */
export const TOAST_VARIANTS = {
  SUCCESS: 'success',
  DANGER: 'danger',
  INFO: 'info',
} as const;
export type ToastVariant = (typeof TOAST_VARIANTS)[keyof typeof TOAST_VARIANTS];

export interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
}

/** How long each kind stays. Failures linger — they are worth reading twice. */
const LIFETIME_MS: Record<ToastVariant, number> = {
  [TOAST_VARIANTS.SUCCESS]: 3500,
  [TOAST_VARIANTS.INFO]: 4500,
  [TOAST_VARIANTS.DANGER]: 7000,
};

let nextId = 1;
let toasts: Toast[] = [];
const listeners = new Set<(next: Toast[]) => void>();

function publish() {
  for (const listener of listeners) listener(toasts);
}

function show(message: string, variant: ToastVariant): number {
  const trimmed = message.trim();
  if (trimmed === '') return -1;

  // The same message twice in a row is one event the reader saw once — a
  // retried mutation should not stack three identical failures.
  const duplicate = toasts.find((t) => t.message === trimmed && t.variant === variant);
  if (duplicate) return duplicate.id;

  const id = nextId++;
  toasts = [...toasts, { id, message: trimmed, variant }];
  publish();
  return id;
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((toast) => toast.id !== id);
  publish();
}

export const toast = {
  success: (message: string) => show(message, TOAST_VARIANTS.SUCCESS),
  error: (message: string) => show(message, TOAST_VARIANTS.DANGER),
  info: (message: string) => show(message, TOAST_VARIANTS.INFO),
  /** Exposed for tests and for a route change that should clear stale news. */
  clear: () => {
    toasts = [];
    publish();
  },
};

function useToasts(): Toast[] {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => toasts,
    () => toasts,
  );
}

/**
 * Renders them. Goes once, high in the app, beside the other providers.
 *
 * `aria-live="polite"` rather than assertive even for failures: a toast never
 * carries something the reader must act on this second, and interrupting them
 * mid-sentence to say "Saved" is worse than waiting for a pause.
 */
export function Toaster() {
  const items = useToasts();

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 p-4 sm:items-end"
    >
      {items.map((item) => (
        <ToastRow key={item.id} toast={item} />
      ))}
    </div>
  );
}

const VARIANT_STYLES: Record<ToastVariant, string> = {
  [TOAST_VARIANTS.SUCCESS]: 'border-success-ink/20 bg-success-subtle text-success-ink',
  [TOAST_VARIANTS.DANGER]: 'border-destructive/25 bg-surface text-foreground',
  [TOAST_VARIANTS.INFO]: 'border-info-ink/20 bg-info-subtle text-info-ink',
};

const VARIANT_ICONS: Record<ToastVariant, typeof Check> = {
  [TOAST_VARIANTS.SUCCESS]: Check,
  [TOAST_VARIANTS.DANGER]: AlertTriangle,
  [TOAST_VARIANTS.INFO]: Info,
};

function ToastRow({ toast: item }: Readonly<{ toast: Toast }>) {
  const [paused, setPaused] = React.useState(false);
  const Icon = VARIANT_ICONS[item.variant];

  React.useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => dismissToast(item.id), LIFETIME_MS[item.variant]);
    return () => clearTimeout(timer);
    // Re-armed when un-paused, so a message the reader hovered to finish
    // reading gets its full life back rather than vanishing on mouse-out.
  }, [item.id, item.variant, paused]);

  return (
    <div
      // pointer-events-auto on the row, not the container: the container spans
      // the width of the screen and would otherwise swallow clicks meant for
      // whatever is behind it.
      className={cn(
        'pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm shadow-lg',
        'animate-toast-in',
        VARIANT_STYLES[item.variant],
      )}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon
        className={cn('mt-0.5 size-4 shrink-0', item.variant === 'danger' && 'text-destructive')}
        aria-hidden
      />
      <span className="min-w-0 flex-1 break-words">{item.message}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismissToast(item.id)}
        className="-mr-1 rounded-sm p-0.5 opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:shadow-focus focus-visible:outline-none"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
