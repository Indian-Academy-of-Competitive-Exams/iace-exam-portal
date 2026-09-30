import { FEATURE_KEYS, type FeatureKey } from '@iace/contracts';

/** Which view of the one student is open. Rides the URL, so a tab is a link somebody can send. */
export const STUDENT_TABS = {
  DETAILS: 'details',
  SERIES: 'series',
  EVENTS: 'events',
  PERFORMANCE: 'performance',
  ACTIONS: 'actions',
} as const;

export type StudentTab = (typeof STUDENT_TABS)[keyof typeof STUDENT_TABS];

export const STUDENT_TAB_LABELS: Readonly<Record<StudentTab, string>> = {
  [STUDENT_TABS.DETAILS]: 'Details & Access',
  [STUDENT_TABS.SERIES]: 'Series',
  [STUDENT_TABS.EVENTS]: 'Events & Programs',
  [STUDENT_TABS.PERFORMANCE]: 'Performance',
  [STUDENT_TABS.ACTIONS]: 'Actions',
};

export interface StudentTabRights {
  can: (key: FeatureKey) => boolean;
  isSuperAdmin: boolean;
}

/** A tab nobody may open is left OUT, never drawn disabled — the same rule a row action follows. */
export function studentTabsFor({ can }: StudentTabRights): readonly StudentTab[] {
  const performance = can(FEATURE_KEYS.STUDENT_PERFORMANCE);

  return [
    STUDENT_TABS.DETAILS,
    STUDENT_TABS.SERIES,
    STUDENT_TABS.EVENTS,
    ...(performance ? [STUDENT_TABS.PERFORMANCE] : []),
    STUDENT_TABS.ACTIONS,
  ];
}

/** A URL naming a tab the reader may not open lands on the first one they may. */
export function openStudentTab(asked: string | undefined, rights: StudentTabRights): StudentTab {
  const allowed = studentTabsFor(rights);
  return allowed.find((tab) => tab === asked) ?? STUDENT_TABS.DETAILS;
}
