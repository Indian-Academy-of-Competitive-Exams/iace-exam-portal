import { noContentSchema, type NoContent, type Paginated } from '../envelope';
import {
  ADMIN_ADMIN_ROUTES,
  ADMIN_FEATURE_ROUTES,
  adminSchema,
  featureSchema,
  type Admin,
  type AdminListQueryInput,
  type CreateAdminInput,
  type Feature,
  type PermissionChanges,
  type UpdateAdminBody,
} from '../admins';
import { erasureReceiptSchema, type ErasureReceipt } from '../me';
import {
  ADMIN_BRANCH_ROUTES,
  branchSchema,
  type Branch,
  type BranchListQueryInput,
  type CreateBranchInput,
  type UpdateBranchInput,
} from '../branches';
import {
  PERFORMANCE_ROUTES,
  performanceReportSchema,
  reportSittingSchema,
  type PerformanceReport,
  type PerformanceReportQueryInput,
  type ReportSitting,
} from '../stats';
import {
  ADMIN_STUDENT_ROUTES,
  studentDeskCodeSchema,
  studentDetailSchema,
  studentSummarySchema,
  type CreateStudentInput,
  type ChangeStudentMobileInput,
  type StudentDeskCode,
  type SetStudentTestBlockedBody,
  type StudentDetail,
  type StudentExportQueryInput,
  type StudentExportView,
  type StudentSittingsQueryInput,
  type StudentListQueryInput,
  type StudentSummary,
  type UpdateStudentInput,
} from '../students';
import { queryString, type ApiCore } from './core';

export function adminPeopleClient(core: ApiCore) {
  const { get, write, list, requestExport } = core;

  return {
    students: {
      list: (query: StudentListQueryInput = {}): Promise<Paginated<StudentSummary>> =>
        list(ADMIN_STUDENT_ROUTES.list, query, studentSummarySchema),

      detail: (id: string): Promise<StudentDetail> =>
        get(ADMIN_STUDENT_ROUTES.detail(id), studentDetailSchema),

      create: (input: CreateStudentInput): Promise<StudentDetail> =>
        write('POST', ADMIN_STUDENT_ROUTES.create, studentDetailSchema, input),

      update: (id: string, input: UpdateStudentInput): Promise<StudentDetail> =>
        write('PATCH', ADMIN_STUDENT_ROUTES.update(id), studentDetailSchema, input),

      setActive: (id: string, isActive: boolean): Promise<StudentDetail> =>
        write('PATCH', ADMIN_STUDENT_ROUTES.setActive(id), studentDetailSchema, { isActive }),

      setTestBlocked: (id: string, input: SetStudentTestBlockedBody): Promise<StudentDetail> =>
        write('PATCH', ADMIN_STUDENT_ROUTES.setTestBlocked(id), studentDetailSchema, input),

      changeMobile: (id: string, input: ChangeStudentMobileInput): Promise<StudentDetail> =>
        write('PATCH', ADMIN_STUDENT_ROUTES.changeMobile(id), studentDetailSchema, input),

      /** A code to read out to them. Each call makes a new one and retires the last. */
      issueDeskCode: (id: string): Promise<StudentDeskCode> =>
        write('POST', ADMIN_STUDENT_ROUTES.deskCode(id), studentDeskCodeSchema),

      /** Their evaluated sittings, paged. The share picker's own list is capped; a report's is not. */
      sittings: (id: string, query: StudentSittingsQueryInput): Promise<Paginated<ReportSitting>> =>
        list(ADMIN_STUDENT_ROUTES.sittings(id), query, reportSittingSchema),

      /** Every student the list's filters match, as one workbook; the page is not sent. */
      export: (
        query: Omit<StudentExportQueryInput, 'view'>,
        view: StudentExportView,
      ): Promise<Blob> => requestExport(ADMIN_STUDENT_ROUTES.export, { ...query, view }),

      /** Anonymises the person. Super admin only, and every sitting they sat is left standing. */
      erase: (id: string): Promise<ErasureReceipt> =>
        write('POST', ADMIN_STUDENT_ROUTES.erasure(id), erasureReceiptSchema),

      /** Any student's analytics, behind STUDENT_PERFORMANCE. Same payload the student reads. */
      performance: (id: string, query: PerformanceReportQueryInput): Promise<PerformanceReport> =>
        get(
          `${PERFORMANCE_ROUTES.ofStudent(id)}${queryString({ ...query })}`,
          performanceReportSchema,
        ),
    },

    /** Super admin only, enforced server-side. The client does not re-state it. */
    admins: {
      list: (query: AdminListQueryInput = {}): Promise<Paginated<Admin>> =>
        list(ADMIN_ADMIN_ROUTES.list, query, adminSchema),

      create: (input: CreateAdminInput): Promise<Admin> =>
        write('POST', ADMIN_ADMIN_ROUTES.create, adminSchema, input),

      /** Display fields only — the role labels the person, it does not grant them anything. */
      update: (id: string, input: UpdateAdminBody): Promise<Admin> =>
        write('PATCH', ADMIN_ADMIN_ROUTES.update(id), adminSchema, input),

      /** Deactivating prunes every grant. Reactivating does NOT restore them. */
      setActive: (id: string, isActive: boolean): Promise<Admin> =>
        write('PATCH', ADMIN_ADMIN_ROUTES.setActive(id), adminSchema, { isActive }),

      /** Every edit to one admin's access in one save, which applies whole or not at all. */
      setPermissions: (id: string, changes: PermissionChanges): Promise<Admin> =>
        write('PATCH', ADMIN_ADMIN_ROUTES.permissions(id), adminSchema, changes),
    },

    features: {
      list: (): Promise<Feature[]> => get(ADMIN_FEATURE_ROUTES.list, featureSchema.array()),
    },

    branches: {
      list: (query: BranchListQueryInput = {}): Promise<Paginated<Branch>> =>
        list(ADMIN_BRANCH_ROUTES.list, query, branchSchema),

      create: (input: CreateBranchInput): Promise<Branch> =>
        write('POST', ADMIN_BRANCH_ROUTES.create, branchSchema, input),

      update: (id: string, input: UpdateBranchInput): Promise<Branch> =>
        write('PATCH', ADMIN_BRANCH_ROUTES.update(id), branchSchema, input),

      remove: (id: string): Promise<NoContent> =>
        write('DELETE', ADMIN_BRANCH_ROUTES.remove(id), noContentSchema),
    },
  };
}
