/**
 * The last full URL seen for each nav route, so a crumb returns a list as it was left rather than
 * to its bare route — filters and the open tab live in the query string.
 *
 * In memory, not storage: a reload is the user saying start again.
 */
const seen = new Map<string, string>();

export function rememberNavUrl(route: string, url: string): void {
  seen.set(route, url);
}

/** The remembered URL for a route, or the route itself when it has not been visited. */
export function recallNavUrl(route: string): string {
  return seen.get(route) ?? route;
}

/** Test seam. Nothing in the app calls this — a module-level map outlives a single render tree. */
export function forgetNavUrls(): void {
  seen.clear();
}
