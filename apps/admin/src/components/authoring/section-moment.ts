import { ASSIGNMENT_ROLES, type AssignmentWithTest } from '@iace/contracts';

/** Who has the section open: the one who types it, the one who reads it, or whoever builds the test. */
export const SECTION_VIEWERS = {
  TYPIST: 'TYPIST',
  READER: 'READER',
  OWNER: 'OWNER',
} as const;
export type SectionViewer = (typeof SECTION_VIEWERS)[keyof typeof SECTION_VIEWERS];

/** How far the section has got, derived from the stamps — never stored. */
export const SECTION_MOMENTS = {
  TYPING: 'TYPING',
  WAITING: 'WAITING',
  READING: 'READING',
  READ: 'READ',
  BUILDING: 'BUILDING',
  OFFERED: 'OFFERED',
} as const;
export type SectionMoment = (typeof SECTION_MOMENTS)[keyof typeof SECTION_MOMENTS];

/** Which of a viewer's own rows opened the section; a queue row names its role in `?as=`. */
export const SECTION_AS = { TYPIST: 'typist', READER: 'reader' } as const;
export type SectionAs = (typeof SECTION_AS)[keyof typeof SECTION_AS];

export interface SectionSeat {
  viewer: SectionViewer;
  /** The viewer's own assignment on the section; null for the test's owner. */
  row: AssignmentWithTest | null;
}

/** A typist's row wins unless the reader's was asked for: one admin rarely holds both. */
export function seatOf(mine: readonly AssignmentWithTest[], as: string | null): SectionSeat {
  const typing = mine.find((row) => row.role === ASSIGNMENT_ROLES.TYPIST) ?? null;
  const reading = mine.find((row) => row.role === ASSIGNMENT_ROLES.PROOFREADER) ?? null;
  if (reading && (as === SECTION_AS.READER || !typing)) {
    return { viewer: SECTION_VIEWERS.READER, row: reading };
  }
  if (typing) return { viewer: SECTION_VIEWERS.TYPIST, row: typing };
  return { viewer: SECTION_VIEWERS.OWNER, row: null };
}

export function momentOf(seat: SectionSeat, offered: boolean): SectionMoment {
  if (offered) return SECTION_MOMENTS.OFFERED;
  const { viewer, row } = seat;
  if (viewer === SECTION_VIEWERS.OWNER || row === null) return SECTION_MOMENTS.BUILDING;
  if (viewer === SECTION_VIEWERS.TYPIST) {
    if (row.finalizedAt === null) return SECTION_MOMENTS.TYPING;
    return row.readerDone ? SECTION_MOMENTS.READ : SECTION_MOMENTS.READING;
  }
  if (row.finalizedAt !== null) return SECTION_MOMENTS.READ;
  return row.typistDone === false ? SECTION_MOMENTS.WAITING : SECTION_MOMENTS.READING;
}

export const SECTION_ADD = { INTO_SECTION: 'INTO_SECTION', TO_BANK: 'TO_BANK' } as const;
export type SectionAdd = (typeof SECTION_ADD)[keyof typeof SECTION_ADD];

export const SECTION_PRIMARY = { DONE: 'DONE', READ: 'READ' } as const;
export type SectionPrimary = (typeof SECTION_PRIMARY)[keyof typeof SECTION_PRIMARY];

/** The five things that change with the viewer and the moment; the screen around them never does. */
export interface SectionSlots {
  primary: SectionPrimary | null;
  sendBack: boolean;
  add: SectionAdd | null;
  importSheet: boolean;
  editable: boolean;
  alert: { variant: 'info' | 'success' | 'warning'; text: string } | null;
}

const LOCKED: SectionSlots = {
  primary: null,
  sendBack: false,
  add: null,
  importSheet: false,
  editable: false,
  alert: null,
};

const FROZEN = {
  variant: 'warning',
  text: 'The paper is frozen. Dropping a question or paying it as a bonus is the only change left, on the paper screen.',
} as const;

function typistSlots(moment: SectionMoment): SectionSlots {
  switch (moment) {
    case SECTION_MOMENTS.TYPING:
      return {
        ...LOCKED,
        primary: SECTION_PRIMARY.DONE,
        add: SECTION_ADD.INTO_SECTION,
        importSheet: true,
        editable: true,
      };
    case SECTION_MOMENTS.READING:
      return {
        ...LOCKED,
        add: SECTION_ADD.TO_BANK,
        editable: true,
        alert: {
          variant: 'info',
          text: 'Marked done. You can fix what you typed until it is read; a new question goes to the bank, not this paper.',
        },
      };
    case SECTION_MOMENTS.READ:
      return {
        ...LOCKED,
        add: SECTION_ADD.TO_BANK,
        alert: {
          variant: 'success',
          text: 'Read and closed. Further changes go through the test owner.',
        },
      };
    default:
      return { ...LOCKED, add: SECTION_ADD.TO_BANK, alert: FROZEN };
  }
}

function readerSlots(moment: SectionMoment, row: AssignmentWithTest | null): SectionSlots {
  switch (moment) {
    case SECTION_MOMENTS.WAITING:
      return {
        ...LOCKED,
        alert: {
          variant: 'info',
          text: 'Its typist has not marked this section done. It reaches you whole when they do.',
        },
      };
    case SECTION_MOMENTS.READING:
      return {
        ...LOCKED,
        primary: SECTION_PRIMARY.READ,
        sendBack: row?.typistDone === true,
        editable: true,
      };
    case SECTION_MOMENTS.READ:
      return {
        ...LOCKED,
        alert: {
          variant: 'success',
          text: 'You marked this section read. Its questions are no longer yours to change.',
        },
      };
    default:
      return { ...LOCKED, alert: FROZEN };
  }
}

export function slotsFor(
  seat: SectionSeat,
  moment: SectionMoment,
  isSuperAdmin: boolean,
): SectionSlots {
  if (seat.viewer === SECTION_VIEWERS.TYPIST) return typistSlots(moment);
  if (seat.viewer === SECTION_VIEWERS.READER) return readerSlots(moment, seat.row);
  if (moment === SECTION_MOMENTS.OFFERED) return { ...LOCKED, alert: FROZEN };
  return { ...LOCKED, editable: isSuperAdmin };
}
