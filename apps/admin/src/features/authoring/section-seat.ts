import {
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  SECTION_SEATS,
  type FeatureKey,
  type PermissionLevel,
  type SectionWork,
} from '@iace/contracts';
import { SECTION_KEYS } from '../../lib/constants';

/** What the viewer can do right now, read off the section and the levels they hold, once for the page and every card. */
export function seatOf(
  work: SectionWork,
  can: (key: FeatureKey, level: PermissionLevel) => boolean,
) {
  const own = work.seatReplaced ? null : work.seat;
  const { WRITE } = PERMISSION_LEVELS;
  // A section write answers any of its three keys at WRITE; typing and releasing each ask for their own.
  const writes = SECTION_KEYS.some((key) => can(key, WRITE));
  const types = can(FEATURE_KEYS.QUESTION_AUTHORING, WRITE);
  return {
    writes,
    reading: writes && own === SECTION_SEATS.READER && Boolean(work.reader?.canMarkRead),
    typing: types && own === SECTION_SEATS.TYPIST && Boolean(work.typist?.canMarkDone),
    fixing: writes && own === SECTION_SEATS.TYPIST && !work.offered,
    releasing: work.canRelease && can(FEATURE_KEYS.QUESTION_PROOFREAD, WRITE),
  };
}

export type Seat = ReturnType<typeof seatOf>;
