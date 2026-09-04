import { TEST_SERIES_KIND, type TestSeriesKind } from '@iace/contracts';

/** What a series is worth switching on AS it is created: a kind reaching past branches has nothing to wait for. */
export const startsSwitchedOn = (kind: TestSeriesKind): boolean =>
  kind !== TEST_SERIES_KIND.STANDARD;

/** `isEnabled` has ONE owner: a caller who does not pass it must not move it. */
export function isEnabledPatch(chosen: boolean | undefined): { isEnabled?: boolean } {
  return chosen === undefined ? {} : { isEnabled: chosen };
}
