/** What a read of a marked paper means while the marking job is still queued. */
import { AppException, ErrorCodes } from '@iace/contracts';
import { shouldRetryRead } from './query-client';

/** A queued marking job is the only reason a card or the solutions 409; anything else is a real failure. */
export const isMarkingPending = (error: unknown): boolean =>
  AppException.is(error) && error.code === ErrorCodes.CONFLICT;

/** A sitting the institute set aside is never marked: its read is refused for good, so nothing retries it. */
export const isSittingVoided = (error: unknown): boolean =>
  AppException.is(error) && error.code === ErrorCodes.SITTING_VOIDED;

/** Either way there is no result to draw, and the screen says which itself rather than a banner. */
export const hasNoResult = (error: unknown): boolean =>
  isMarkingPending(error) || isSittingVoided(error);

/** The set-aside screen's words, the same on both apps. */
export const SITTING_VOIDED_SAYS = {
  title: 'This sitting was set aside',
  hint: 'It carries no marks and no rank.',
} as const;

/** How often a marked paper's read asks again by itself before it says the marks are not in. */
export const MARKING_TRIES = 3;

/** A queued job answers within seconds, so the read waits on it rather than handing the student a Retry. */
export const retryWhileMarking = (failures: number, error: unknown): boolean =>
  isMarkingPending(error) ? failures < MARKING_TRIES : shouldRetryRead(failures, error);
