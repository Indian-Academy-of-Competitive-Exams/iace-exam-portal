/** Joins truthy class names — no conflicting utilities collide in this app's own components. */
export function cn(...classes: readonly (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
