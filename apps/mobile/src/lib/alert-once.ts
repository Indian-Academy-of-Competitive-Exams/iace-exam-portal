/** Past this an alert is taken as gone, so a dismissal that never reported cannot silence its message for good. */
const HOLD_MS = 30_000;

/** One alert per failure: a message is not raised again over the alert already saying it. */
export function alertOnce(
  raise: (message: string, onDismiss: () => void) => void,
  now: () => number = Date.now,
): (message: string) => void {
  const upSince = new Map<string, number>();

  return (message) => {
    const since = upSince.get(message);
    if (since !== undefined && now() - since < HOLD_MS) return;
    upSince.set(message, now());
    raise(message, () => upSince.delete(message));
  };
}
