import { type Paginated, type PaginationQueryInput } from '../envelope';
import {
  ADMIN_AUDIT_ROUTES,
  importLogSchema,
  rowActionSchema,
  type ImportLogSummary,
  type RowAction,
  type RowActionExportQueryInput,
  type RowActionListQueryInput,
} from '../audit';
import { ADMIN_DASHBOARD_ROUTES, dashboardSchema, type Dashboard } from '../dashboard';
import {
  ADMIN_REPORT_ROUTES,
  reportChoiceSchema,
  reportDocumentSchema,
  type ReportChoice,
  type ReportChoiceParam,
  type ReportChoicesQueryInput,
  type ReportDocument,
  type ReportKey,
  type ReportQueryInput,
} from '../reports';
import {
  ANNOUNCEMENT_ROUTES,
  announcementPreviewSchema,
  announcementSchema,
  announcementSummarySchema,
  type Announcement,
  type AnnouncementSummary,
  type AnnouncementListQueryInput,
  type AnnouncementPreview,
  type CreateAnnouncementInput,
} from '../announcements';
import {
  ADMIN_LIVE_OPS_ROUTES,
  liveOpsBoardSchema,
  liveOpsTestSchema,
  resolvedAttemptSchema,
  type ExtendAttemptInput,
  type ForceSubmitAttemptInput,
  type LiveOpsBoard,
  type LiveOpsTest,
  type LiveOpsTestQueryInput,
  type ResetAttemptInput,
  type ResolvedAttempt,
  type VoidAttemptInput,
} from '../live-ops';
import { queryString, type ApiCore } from './core';

export function adminOpsClient(core: ApiCore) {
  const { get, write, list, requestBlob, requestExport } = core;

  return {
    /** Watching one test's sittings, and resolving the ones that broke. */
    liveOps: {
      tests: (query: LiveOpsTestQueryInput = {}): Promise<Paginated<LiveOpsTest>> =>
        list(ADMIN_LIVE_OPS_ROUTES.tests, query, liveOpsTestSchema),

      board: (testId: string): Promise<LiveOpsBoard> =>
        get(ADMIN_LIVE_OPS_ROUTES.board(testId), liveOpsBoardSchema),

      forceSubmit: (attemptId: string, input: ForceSubmitAttemptInput): Promise<ResolvedAttempt> =>
        write('POST', ADMIN_LIVE_OPS_ROUTES.forceSubmit(attemptId), resolvedAttemptSchema, input),

      extend: (attemptId: string, input: ExtendAttemptInput): Promise<ResolvedAttempt> =>
        write('POST', ADMIN_LIVE_OPS_ROUTES.extend(attemptId), resolvedAttemptSchema, input),

      reset: (attemptId: string, input: ResetAttemptInput): Promise<ResolvedAttempt> =>
        write('POST', ADMIN_LIVE_OPS_ROUTES.reset(attemptId), resolvedAttemptSchema, input),

      void: (attemptId: string, input: VoidAttemptInput): Promise<ResolvedAttempt> =>
        write('POST', ADMIN_LIVE_OPS_ROUTES.void(attemptId), resolvedAttemptSchema, input),
    },

    /** What an admin says to a cohort, and what reaching them cost. */
    announcements: {
      list: (query: AnnouncementListQueryInput = {}): Promise<Paginated<AnnouncementSummary>> =>
        list(ANNOUNCEMENT_ROUTES.list, query, announcementSummarySchema),

      /** Asked while composing. Changes nothing — the cohort is read off the body. */
      preview: (input: CreateAnnouncementInput): Promise<AnnouncementPreview> =>
        write('POST', ANNOUNCEMENT_ROUTES.preview, announcementPreviewSchema, input),

      send: (input: CreateAnnouncementInput): Promise<Announcement> =>
        write('POST', ANNOUNCEMENT_ROUTES.create, announcementSchema, input),

      detail: (id: string): Promise<Announcement> =>
        get(ANNOUNCEMENT_ROUTES.detail(id), announcementSchema),

      deliveriesExport: (id: string): Promise<Blob> =>
        requestExport(ANNOUNCEMENT_ROUTES.deliveriesExport(id)),
    },

    /** The landing screen. One payload, carrying only the bands the caller may see. */
    dashboard: {
      get: (): Promise<Dashboard> => get(ADMIN_DASHBOARD_ROUTES.get, dashboardSchema),
    },

    /** One document a report: the screen previews it, the printer takes it whole. */
    reports: {
      read: (key: ReportKey, query: ReportQueryInput): Promise<ReportDocument> =>
        get(`${ADMIN_REPORT_ROUTES.read(key)}${queryString({ ...query })}`, reportDocumentSchema),

      export: (key: ReportKey, query: ReportQueryInput): Promise<Blob> =>
        requestExport(ADMIN_REPORT_ROUTES.export(key), { ...query }),

      /** What a report's picker offers, behind the same key as the report it is asking for. */
      choices: (
        param: ReportChoiceParam,
        query: ReportChoicesQueryInput = {},
      ): Promise<Paginated<ReportChoice>> =>
        list(ADMIN_REPORT_ROUTES.choices(param), query, reportChoiceSchema),
    },

    audit: {
      rowActions: (query: RowActionListQueryInput = {}): Promise<Paginated<RowAction>> =>
        list(ADMIN_AUDIT_ROUTES.rowActions, query, rowActionSchema),

      rowActionsExport: (query: RowActionExportQueryInput): Promise<Blob> =>
        requestExport(ADMIN_AUDIT_ROUTES.rowActionsExport, { ...query }),

      /** The sheet a run was fed — a Blob, not an envelope. */
      importFile: (id: string): Promise<Blob> => requestBlob(ADMIN_AUDIT_ROUTES.importFile(id)),

      imports: (query: PaginationQueryInput = {}): Promise<Paginated<ImportLogSummary>> =>
        list(ADMIN_AUDIT_ROUTES.imports, query, importLogSchema),
    },
  };
}
