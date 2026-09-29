/** What a read of a marked paper means while the marking job is still queued. */
import { AppException, ErrorCodes } from '@iace/contracts';

/** A queued marking job is the only reason a card or the solutions 409; anything else is a real failure. */
export const isMarkingPending = (error: unknown): boolean =>
  AppException.is(error) && error.code === ErrorCodes.CONFLICT;
