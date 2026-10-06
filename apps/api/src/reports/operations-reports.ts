/**
 * The reports about running the platform: what was changed and by whom, what was sent and what it
 * was priced at, and who may do what. The audit trail is read through `AuditService`, which scopes
 * an admin to their own rows exactly as its screen does.
 */
import { DeliveryStatus } from '@prisma/client';
import {
  AUDIT_ACTION,
  AUDIT_ACTOR_TYPE,
  FEATURES,
  FEATURE_KEY_VALUES,
  PERMISSION_LEVELS,
  REPORT_KEYS,
  rowActionExportQuerySchema,
  type AuditAction,
  type DeliveryChannel,
  type PermissionLevel,
  type ReportQueryOf,
} from '@iace/contracts';
import { EXPORT_DATE_FORMATS, exportInstant, type ExportColumn } from '../common/exporting';
import { aboutPeriod, periodOf } from './period';
import { type ReportBuilder } from './report';
import { groupBy } from './report-figures';
import { adminNames } from './report-people';

type PeriodBuilder = ReportBuilder<ReportQueryOf<typeof REPORT_KEYS.AUDIT_TRAIL>>;
type OpenBuilder = ReportBuilder<ReportQueryOf<typeof REPORT_KEYS.PERMISSIONS_MATRIX>>;

const PAISE = 100;

const ACTION_LABELS = {
  [AUDIT_ACTION.CREATE]: 'Created',
  [AUDIT_ACTION.UPDATE]: 'Updated',
  [AUDIT_ACTION.DELETE]: 'Deleted',
  [AUDIT_ACTION.ACTIVATE]: 'Activated',
  [AUDIT_ACTION.DEACTIVATE]: 'Deactivated',
  [AUDIT_ACTION.BLOCK]: 'Blocked',
  [AUDIT_ACTION.UNBLOCK]: 'Unblocked',
  [AUDIT_ACTION.IMPORT]: 'Imported',
  [AUDIT_ACTION.EXPORT]: 'Exported',
} as const satisfies Record<AuditAction, string>;

const auditTrail: PeriodBuilder = async ({ audit }, query, viewer) => {
  const period = periodOf(query);
  const sheet = await audit.rowActionSheet(
    rowActionExportQuerySchema.parse({ from: period.from, to: period.to }),
    viewer,
  );
  return {
    about: [aboutPeriod(period)],
    figures: [{ label: 'Changes', value: sheet.rows.length }],
    sheets: [sheet],
  };
};

interface Activity {
  name: string;
  counts: Partial<Record<AuditAction, number>>;
}

const ACTIVITY_COLUMNS: ExportColumn<Activity>[] = [
  { header: 'Admin', width: 26, value: (row) => row.name },
  ...Object.values(AUDIT_ACTION).map((action): ExportColumn<Activity> => ({
    header: ACTION_LABELS[action],
    width: 12,
    value: (row) => row.counts[action] ?? 0,
  })),
  {
    header: 'Total',
    width: 9,
    value: (row) => Object.values(row.counts).reduce((sum, count) => sum + count, 0),
  },
];

/** What each admin did, counted off the trail itself; a change older than the trail's window is not in it. */
const adminActivity: PeriodBuilder = async ({ prisma }, query) => {
  const period = periodOf(query);
  const counted = await prisma.rowActionLog.groupBy({
    by: ['actorId', 'action'],
    where: { actorType: AUDIT_ACTOR_TYPE.ADMIN, createdAt: period.within },
    _count: true,
  });
  const names = await adminNames(
    prisma,
    counted.map((row) => row.actorId),
  );
  const rows = [...groupBy(counted, (row) => row.actorId)]
    .map(([id, held]): Activity => {
      const counts: Partial<Record<AuditAction, number>> = {};
      for (const row of held) counts[row.action] = row._count;
      return { name: (id && names.get(id)) ?? 'Removed admin', counts };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    about: [aboutPeriod(period)],
    figures: [{ label: 'Changes', value: counted.reduce((sum, row) => sum + row._count, 0) }],
    sheets: [{ name: 'Admin activity', columns: ACTIVITY_COLUMNS, rows }],
  };
};

interface Sent {
  title: string;
  by: string;
  at: Date;
  recipients: number;
  paidChannels: DeliveryChannel[];
  costPaise: number;
}

const SENT_COLUMNS: ExportColumn<Sent>[] = [
  {
    header: 'Sent',
    width: 18,
    date: EXPORT_DATE_FORMATS.INSTANT,
    value: (row) => exportInstant(row.at),
  },
  { header: 'Announcement', width: 40, value: (row) => row.title },
  { header: 'By', width: 24, value: (row) => row.by },
  { header: 'Recipients', width: 11, value: (row) => row.recipients },
  { header: 'Paid channels', width: 18, value: (row) => row.paidChannels.join(', ') },
  { header: 'Estimated cost (rupees)', width: 22, value: (row) => row.costPaise / PAISE },
];

interface Delivered {
  channel: DeliveryChannel;
  counts: Partial<Record<DeliveryStatus, number>>;
}

const STATUS_LABELS = {
  [DeliveryStatus.PENDING]: 'Pending',
  [DeliveryStatus.SENT]: 'Sent',
  [DeliveryStatus.DELIVERED]: 'Delivered',
  [DeliveryStatus.FAILED]: 'Failed',
  [DeliveryStatus.SKIPPED]: 'Skipped',
} as const satisfies Record<DeliveryStatus, string>;

const DELIVERED_COLUMNS: ExportColumn<Delivered>[] = [
  { header: 'Channel', width: 14, value: (row) => row.channel },
  ...Object.values(DeliveryStatus).map((status): ExportColumn<Delivered> => ({
    header: STATUS_LABELS[status],
    width: 11,
    value: (row) => row.counts[status] ?? 0,
  })),
];

/** The cost is what was priced at send time, which is what the row kept: today's rates would misreport it. */
const announcements: PeriodBuilder = async ({ prisma }, query) => {
  const period = periodOf(query);
  const sent = await prisma.announcement.findMany({
    where: { createdAt: period.within },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      createdAt: true,
      recipientCount: true,
      paidChannels: true,
      estimatedCostPaise: true,
      createdBy: { select: { fullName: true, email: true } },
    },
  });
  const deliveries = await prisma.notificationDelivery.groupBy({
    by: ['channel', 'status'],
    where: { notification: { announcementId: { in: sent.map((row) => row.id) } } },
    _count: true,
  });
  const rows = sent.map((row) => ({
    title: row.title,
    by: row.createdBy.fullName ?? row.createdBy.email,
    at: row.createdAt,
    recipients: row.recipientCount,
    paidChannels: row.paidChannels,
    costPaise: row.estimatedCostPaise,
  }));
  const delivered = [...groupBy(deliveries, (row) => row.channel)].map(([channel, held]) => {
    const counts: Partial<Record<DeliveryStatus, number>> = {};
    for (const row of held) counts[row.status] = row._count;
    return { channel, counts };
  });
  return {
    about: [aboutPeriod(period)],
    figures: [
      { label: 'Announcements', value: rows.length },
      { label: 'Recipients', value: rows.reduce((sum, row) => sum + row.recipients, 0) },
      {
        label: 'Estimated cost (rupees)',
        value: rows.reduce((sum, row) => sum + row.costPaise, 0) / PAISE,
      },
    ],
    sheets: [
      { name: 'Announcements', columns: SENT_COLUMNS, rows },
      { name: 'Deliveries', columns: DELIVERED_COLUMNS, rows: delivered },
    ],
  };
};

interface Holder {
  name: string;
  email: string;
  isSuperAdmin: boolean;
  isActive: boolean;
  levels: ReadonlyMap<string, PermissionLevel>;
}

const LEVEL_LABELS = {
  [PERMISSION_LEVELS.READ]: 'Read',
  [PERMISSION_LEVELS.WRITE]: 'Write',
} as const satisfies Record<PermissionLevel, string>;

/** A super admin holds no grant at all — they pass every check — so each cell says so rather than reading blank. */
const levelOf = (row: Holder, key: string): string | null => {
  if (row.isSuperAdmin) return 'All';
  const level = row.levels.get(key);
  return level === undefined ? null : LEVEL_LABELS[level];
};

const HOLDER_COLUMNS: ExportColumn<Holder>[] = [
  { header: 'Admin', width: 26, value: (row) => row.name },
  { header: 'Email', width: 30, fileOnly: true, value: (row) => row.email },
  { header: 'Status', width: 12, value: (row) => (row.isActive ? 'Active' : 'Deactivated') },
  ...FEATURE_KEY_VALUES.map((key): ExportColumn<Holder> => ({
    header: FEATURES[key].label,
    width: 16,
    value: (row) => levelOf(row, key),
  })),
];

const permissionsMatrix: OpenBuilder = async ({ prisma }) => {
  const admins = await prisma.admin.findMany({
    orderBy: [{ fullName: 'asc' }, { email: 'asc' }],
    select: {
      fullName: true,
      email: true,
      isSuperAdmin: true,
      isActive: true,
      permissions: { select: { featureKey: true, level: true } },
    },
  });
  const rows = admins.map((admin) => ({
    name: admin.fullName ?? admin.email,
    email: admin.email,
    isSuperAdmin: admin.isSuperAdmin,
    isActive: admin.isActive,
    levels: new Map(admin.permissions.map((grant) => [grant.featureKey, grant.level])),
  }));
  return {
    about: [],
    figures: [
      { label: 'Admins', value: rows.length },
      { label: 'Super admins', value: rows.filter((row) => row.isSuperAdmin).length },
    ],
    sheets: [{ name: 'Permissions', columns: HOLDER_COLUMNS, rows }],
  };
};

export const OPERATIONS_REPORTS = {
  [REPORT_KEYS.AUDIT_TRAIL]: auditTrail,
  [REPORT_KEYS.ADMIN_ACTIVITY]: adminActivity,
  [REPORT_KEYS.ANNOUNCEMENTS]: announcements,
  [REPORT_KEYS.PERMISSIONS_MATRIX]: permissionsMatrix,
};
