import {
  BookOpen,
  Building2,
  PenLine,
  ClipboardList,
  FileChartColumn,
  FolderTree,
  GraduationCap,
  Inbox,
  LifeBuoy,
  History,
  ListChecks,
  Megaphone,
  KeyRound,
  Layers,
  Radar,
  Route,
  ShieldCheck,
  SpellCheck,
  SlidersHorizontal,
  Upload,
  Users,
} from 'lucide-react';
import { type NavItem } from '@iace/app-kit';
import { FEATURE_KEYS } from '@iace/contracts';
import { ROUTES } from './constants';

// AdminNavItem adds superAdminOnly, which is NOT a feature key — it gates the screens that decide who decides.

export interface AdminNavItem extends NavItem {
  superAdminOnly?: boolean;
  children?: AdminNavItem[];
}

/** The nav, in the order an admin works through it. Home is the mark, not a row here. */
export const NAV_ITEMS: readonly AdminNavItem[] = [
  {
    label: 'Students',
    icon: Users,
    featureKey: FEATURE_KEYS.STUDENT_MANAGEMENT,
    children: [
      { to: ROUTES.STUDENTS, label: 'All students', icon: Users },
      { to: ROUTES.BRANCHES, label: 'Branches', icon: Building2 },
      { to: ROUTES.EXAMS, label: 'Exams', icon: GraduationCap },
      { to: ROUTES.COHORTS, label: 'Programs and events', icon: Route },
    ],
  },
  {
    label: 'Support',
    icon: LifeBuoy,
    featureKey: FEATURE_KEYS.SUPPORT,
    children: [{ to: ROUTES.SUPPORT, label: 'Queries', icon: Inbox }],
  },
  {
    label: 'Question bank',
    icon: BookOpen,
    featureKey: FEATURE_KEYS.QUESTION_MANAGEMENT,
    children: [
      { to: ROUTES.QUESTIONS, label: 'All questions', icon: BookOpen },
      { to: ROUTES.TAXONOMY, label: 'Subjects and topics', icon: FolderTree },
    ],
  },
  /** Its own section, on a key of its own: a reader holds sections, never the bank. */
  {
    label: 'Proof-reading',
    icon: SpellCheck,
    featureKey: FEATURE_KEYS.QUESTION_PROOFREAD,
    children: [{ to: ROUTES.PROOFREADING_ASSIGNMENTS, label: 'My sections', icon: ListChecks }],
  },
  /** Its own section, on a key of its own: a typist gets this and not the bank above it. */
  {
    label: 'Authoring',
    icon: PenLine,
    featureKey: FEATURE_KEYS.QUESTION_AUTHORING,
    children: [
      { to: ROUTES.AUTHORING_EDITOR, label: 'Editor', icon: PenLine },
      { to: ROUTES.AUTHORING_ASSIGNMENTS, label: 'My sections', icon: ListChecks },
      { to: ROUTES.AUTHORING_HISTORY, label: 'History', icon: History },
    ],
  },
  {
    label: 'Tests',
    icon: ClipboardList,
    featureKey: FEATURE_KEYS.TEST_MANAGEMENT,
    children: [
      { to: ROUTES.TESTS, label: 'Tests & Test Series', icon: Layers },
      { to: ROUTES.BASE_CONFIGS, label: 'Base configurations', icon: SlidersHorizontal },
      {
        to: ROUTES.SECTION_PROGRESS,
        label: 'Section progress',
        icon: ListChecks,
        superAdminOnly: true,
      },
    ],
  },
  {
    label: 'Live operations',
    icon: Radar,
    featureKey: FEATURE_KEYS.TEST_OPERATIONS,
    children: [{ to: ROUTES.LIVE_OPS, label: 'Sittings', icon: Radar }],
  },
  {
    label: 'Reports',
    icon: FileChartColumn,
    featureKey: FEATURE_KEYS.REPORTS,
    children: [{ to: ROUTES.REPORTS, label: 'All reports', icon: FileChartColumn }],
  },
  {
    label: 'Administration',
    icon: ShieldCheck,
    superAdminOnly: true,
    children: [
      { to: ROUTES.ADMINS, label: 'Admins', icon: ShieldCheck },
      { to: ROUTES.PERMISSIONS, label: 'Permissions', icon: KeyRound },
    ],
  },
  {
    label: 'Announcements',
    icon: Megaphone,
    featureKey: FEATURE_KEYS.NOTIFICATION_MANAGEMENT,
    children: [{ to: ROUTES.ANNOUNCEMENTS, label: 'Sent', icon: Megaphone }],
  },
  {
    label: 'Audit log',
    icon: History,
    superAdminOnly: true,
    children: [
      { to: ROUTES.AUDIT, label: 'Activity', icon: History },
      { to: ROUTES.AUDIT_IMPORTS, label: 'Imports', icon: Upload },
    ],
  },
];
