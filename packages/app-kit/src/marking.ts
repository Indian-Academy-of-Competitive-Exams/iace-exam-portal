/** What a read of a marked paper means while the marking job is still queued. */
import { AppException, ErrorCodes } from '@iace/contracts';
import { shouldRetryRead } from './query-client';

/** A queued marking job is the only reason a card or the solutions 409; anything else is a real failure. */
export const isMarkingPending = (error: unknown): boolean =>
  AppException.is(error) && error.code === ErrorCodes.CONFLICT;

/** How often a marked paper's read asks again by itself before it says the marks are not in. */
export const MARKING_TRIES = 3;

/** A queued job answers within seconds, so the read waits on it rather than handing the student a Retry. */
export const retryWhileMarking = (failures: number, error: unknown): boolean =>
  isMarkingPending(error) ? failures < MARKING_TRIES : shouldRetryRead(failures, error);
