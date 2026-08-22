import { Injectable } from '@nestjs/common';
import {
  AppException,
  AUDIT_FEATURE,
  ErrorCodes,
  FEATURES,
  FEATURE_KEY_VALUES,
  PERMISSION_LEVELS,
  fieldDiff,
  type Admin as AdminDto,
  type AdminListQuery,
  type AdminPermissions,
  type AuditFeature,
  type CreateAdminBody,
  type Feature as FeatureDto,
  type FeatureKey,
  type FieldDiff,
  type PermissionGrantBody,
  type Paginated,
  type PermissionLevel,
  type UpdateAdminBody,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditContext } from '../audit';

/** The two levels a key can be held at. A feature always reports both lists. */
const BOTH_LEVELS = [PERMISSION_LEVELS.READ, PERMISSION_LEVELS.WRITE] as const;

interface AdminRow {
  id: string;
  email: string;
  fullName: string | null;
  isSuperAdmin: boolean;
  isActive: boolean;
  allBranches: boolean;
  createdAt: Date;
  branches: { branchId: string }[];
}

/** Every read hands back the branch scope, because "none" and "all" are different answers. */
const ADMIN_INCLUDE = { branches: { select: { branchId: true } } } as const;

/** What an admin's audit diff covers — every column the admin screens can change. */
export const AUDITED_ADMIN_FIELDS = [
  'fullName',
  'isSuperAdmin',
  'allBranches',
  'branchIds',
] as const;

/** The single column the toggle route moves — the same `fieldDiff` definition of "changed". */
const AUDITED_ACTIVE_FIELDS = ['isActive'] as const;

/** A grant has no row to name, so it is filed against the admin it was made about. */
export function permissionAuditEntity(
  grant: { adminId: string; key: string; level: string },
  revoked = false,
): { feature: AuditFeature; entityId: string; changed: FieldDiff } {
  return {
    feature: AUDIT_FEATURE.FEATURE_PERMISSION,
    entityId: grant.adminId,
    changed: {
      [grant.key]: revoked ? { from: grant.level, to: null } : { from: null, to: grant.level },
    },
  };
}

@Injectable()
export class AdminsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditContext: AuditContext,
  ) {}

  // ==========================================================================
  // The facade auth consumes
  // ==========================================================================

  /**
   * The grant map a token carries. One indexed read, and WRITE wins if both levels are held.
   * A stored key that code no longer defines is dropped rather than carried.
   */
  async permissionsFor(adminId: string): Promise<AdminPermissions> {
    const rows = await this.prisma.adminFeaturePermission.findMany({
      where: { adminId },
      select: { featureKey: true, level: true },
    });

    const permissions: AdminPermissions = {};
    for (const row of rows) {
      const key = asFeatureKey(row.featureKey);
      if (key === null || permissions[key] === PERMISSION_LEVELS.WRITE) continue;
      permissions[key] = row.level;
    }
    return permissions;
  }

  // ==========================================================================
  // Admins
  // ==========================================================================

  /** Returns the full Paginated shape, not just items+total. */
  async list(query: AdminListQuery): Promise<Paginated<AdminDto>> {
    const where = {
      ...(query.activeOnly === undefined ? {} : { isActive: query.activeOnly }),
      ...(query.q
        ? {
            OR: [
              { email: { contains: query.q, mode: 'insensitive' as const } },
              { fullName: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.admin.findMany({
        where,
        include: ADMIN_INCLUDE,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.admin.count({ where }),
    ]);

    // One grants query for the whole page rather than one per row: a list of 50
    // admins would otherwise be 51 queries.
    const grants = await this.grantsByAdmin(rows.map((row) => row.id));
    return {
      items: rows.map((row) => this.toAdminDto(row, grants.get(row.id) ?? {})),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async create(input: CreateAdminBody, createdById: string): Promise<AdminDto> {
    // Pre-checked like every other create here; the global filter still maps a racing P2002 to the
    // same CONFLICT, so the check is for the message rather than for correctness.
    const clash = await this.prisma.admin.findUnique({ where: { email: input.email } });
    if (clash) {
      throw new AppException(ErrorCodes.CONFLICT, 'An admin with that email already exists', {
        fieldErrors: { email: ['An admin with that email already exists'] },
      });
    }

    await this.assertBranchesExist(input.branchIds);

    const row = await this.prisma.admin.create({
      data: {
        email: input.email,
        fullName: input.fullName ?? null,
        isSuperAdmin: input.isSuperAdmin,
        allBranches: input.allBranches,
        createdById,
        branches: { create: (input.branchIds ?? []).map((branchId) => ({ branchId })) },
      },
      include: ADMIN_INCLUDE,
    });
    // A brand-new admin holds nothing until a grant is made, and a super admin
    // never needs one.
    return this.toAdminDto(row, {});
  }

  async update(id: string, input: UpdateAdminBody): Promise<AdminDto> {
    // requireAdmin, not requireActive: renaming a deactivated admin, or making
    // one a super admin before switching them back on, are both reasonable.
    const before = await this.requireAdmin(id);
    await this.assertBranchesExist(input.branchIds);

    const row = await this.prisma.admin.update({
      where: { id },
      data: {
        ...(input.fullName === undefined ? {} : { fullName: input.fullName }),
        ...(input.isSuperAdmin === undefined ? {} : { isSuperAdmin: input.isSuperAdmin }),
        ...(input.allBranches === undefined ? {} : { allBranches: input.allBranches }),
        // Replaced wholesale: the screen holds every branch, not a delta.
        ...(input.branchIds === undefined
          ? {}
          : {
              branches: {
                deleteMany: {},
                create: input.branchIds.map((branchId) => ({ branchId })),
              },
            }),
      },
      include: ADMIN_INCLUDE,
    });

    this.auditContext.setChanged(
      fieldDiff(auditFieldsOf(before), auditFieldsOf(row), AUDITED_ADMIN_FIELDS),
    );

    return this.toAdminDto(row, await this.permissionsFor(id));
  }

  /**
   * Deactivating prunes every grant in the same transaction as the flag.
   * Reactivating does NOT give them back.
   */
  async setActive(id: string, isActive: boolean, actingAdminId: string): Promise<AdminDto> {
    if (!isActive && id === actingAdminId) {
      // Switching yourself off is undone only by another super admin — or, if
      // you were the last one, only with database access.
      throw new AppException(ErrorCodes.CONFLICT, 'You cannot deactivate your own account');
    }
    const before = await this.requireAdmin(id);

    if (isActive) {
      const row = await this.prisma.admin.update({
        where: { id },
        data: { isActive: true },
        include: ADMIN_INCLUDE,
      });
      this.auditContext.setChanged(
        fieldDiff(before, { ...before, isActive: true }, AUDITED_ACTIVE_FIELDS),
      );
      // Read the grants back rather than assuming none: a super admin may have
      // granted something while the account was switched off.
      return this.toAdminDto(row, await this.permissionsFor(id));
    }

    // The update returns the row, so the transaction hands back what to report — no second read, and
    // no chance of reporting a state that something else changed in between.
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.admin.update({
        where: { id },
        data: { isActive: false },
        include: ADMIN_INCLUDE,
      });
      await tx.adminFeaturePermission.deleteMany({ where: { adminId: id } });
      return updated;
    });

    this.auditContext.setChanged(
      fieldDiff(before, { ...before, isActive: false }, AUDITED_ACTIVE_FIELDS),
    );
    return this.toAdminDto(row, {});
  }

  // ==========================================================================
  // Features
  // ==========================================================================

  /** The code-owned key list, with who holds each one. Read-only — nothing registers a feature. */
  async listFeatures(): Promise<FeatureDto[]> {
    const rows = await this.prisma.adminFeaturePermission.findMany({
      select: { adminId: true, featureKey: true, level: true },
    });
    return FEATURE_KEY_VALUES.map((key) => this.toFeatureDto(key, rows));
  }

  // ==========================================================================
  // Grants
  // ==========================================================================

  async grant(input: PermissionGrantBody): Promise<FeatureDto> {
    return this.changeGrant(input, 'add');
  }

  async revoke(input: PermissionGrantBody): Promise<FeatureDto> {
    return this.changeGrant(input, 'remove');
  }

  /** Add or remove one (admin, key, level) row. */
  private async changeGrant(
    input: PermissionGrantBody,
    action: 'add' | 'remove',
  ): Promise<FeatureDto> {
    await this.requireActive(input.adminId);

    // Neither route carries an `:id` param and both return a Feature, so the interceptor's
    // fallback would file the row against the feature rather than the admin it was made about.
    this.auditContext.setEntityId(input.adminId);

    const where = {
      adminId_featureKey_level: {
        adminId: input.adminId,
        featureKey: input.featureKey,
        level: input.level,
      },
    };
    const held = await this.prisma.adminFeaturePermission.findUnique({ where });

    if (action === 'add' && !held) {
      // Create, not upsert: the row IS its own key, so there is nothing to update.
      await this.prisma.adminFeaturePermission.create({ data: { ...input } });
    } else if (action === 'remove' && held) {
      await this.prisma.adminFeaturePermission.delete({ where });
    }

    // A grant that did not move is not a grant that happened.
    if ((action === 'add') !== Boolean(held)) {
      const { changed } = permissionAuditEntity(
        { adminId: input.adminId, key: input.featureKey, level: input.level },
        action === 'remove',
      );
      this.auditContext.setChanged(changed);
    }

    return this.featureWithGrants(input.featureKey);
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  /** Exists at all — the right check when the point is to change their state. */
  private async requireAdmin(id: string): Promise<AdminRow> {
    const admin = await this.prisma.admin.findUnique({ where: { id }, include: ADMIN_INCLUDE });
    if (!admin) throw new AppException(ErrorCodes.NOT_FOUND, 'Admin not found');
    return admin;
  }

  /** A branch that no longer exists would leave the admin scoped to nothing, silently. */
  private async assertBranchesExist(branchIds: string[] | undefined): Promise<void> {
    if (!branchIds?.length) return;

    const wanted = [...new Set(branchIds)];
    const found = await this.prisma.branch.count({ where: { id: { in: wanted } } });
    if (found === wanted.length) return;

    const message = 'One of those branches no longer exists';
    throw new AppException(ErrorCodes.VALIDATION_ERROR, message, {
      fieldErrors: { branchIds: [message] },
    });
  }

  /**
   * Exists AND is switched on — the right check before a grant, because granting to a deactivated
   * admin hands back what deactivation just removed.
   */
  private async requireActive(id: string): Promise<void> {
    const admin = await this.prisma.admin.findUnique({
      where: { id },
      select: { id: true, isActive: true },
    });
    if (!admin?.isActive) throw new AppException(ErrorCodes.NOT_FOUND, 'Admin not found');
  }

  /** Permissions for many admins in one query — see the note in `list`. */
  private async grantsByAdmin(adminIds: string[]): Promise<Map<string, AdminPermissions>> {
    const byAdmin = new Map<string, AdminPermissions>();
    if (adminIds.length === 0) return byAdmin;

    const rows = await this.prisma.adminFeaturePermission.findMany({
      where: { adminId: { in: adminIds } },
      select: { adminId: true, featureKey: true, level: true },
    });

    for (const row of rows) {
      const key = asFeatureKey(row.featureKey);
      if (key === null) continue;
      const current = byAdmin.get(row.adminId) ?? {};
      if (current[key] !== PERMISSION_LEVELS.WRITE) current[key] = row.level;
      byAdmin.set(row.adminId, current);
    }
    return byAdmin;
  }

  /** One key's grant lists, read back after a change. */
  private async featureWithGrants(key: FeatureKey): Promise<FeatureDto> {
    const rows = await this.prisma.adminFeaturePermission.findMany({
      where: { featureKey: key },
      select: { adminId: true, featureKey: true, level: true },
    });
    return this.toFeatureDto(key, rows);
  }

  private toAdminDto(row: AdminRow, permissions: AdminPermissions): AdminDto {
    return {
      id: row.id,
      email: row.email,
      fullName: row.fullName,
      isSuperAdmin: row.isSuperAdmin,
      isActive: row.isActive,
      allBranches: row.allBranches,
      branchIds: row.branches.map((branch) => branch.branchId),
      createdAt: row.createdAt.toISOString(),
      permissions,
    };
  }

  private toFeatureDto(
    key: FeatureKey,
    rows: readonly { adminId: string; featureKey: string; level: PermissionLevel }[],
  ): FeatureDto {
    const held = rows.filter((row) => row.featureKey === key);
    return {
      key,
      label: FEATURES[key].label,
      description: FEATURES[key].description,
      grants: Object.fromEntries(
        BOTH_LEVELS.map((level) => [
          level,
          held.filter((row) => row.level === level).map((row) => row.adminId),
        ]),
      ) as FeatureDto['grants'],
    };
  }
}

/** A stored key code no longer defines. Dropped rather than trusted — the guard reads this map. */
function asFeatureKey(value: string): FeatureKey | null {
  return (FEATURE_KEY_VALUES as readonly string[]).includes(value) ? (value as FeatureKey) : null;
}

/** `branches`, the join rows, flattened to ids — sorted so an unchanged set never reads as a
 *  reorder. Not `localeCompare`: two machines must never order the same id set differently. */
function auditFieldsOf(row: AdminRow): {
  fullName: string | null;
  isSuperAdmin: boolean;
  allBranches: boolean;
  branchIds: string[];
} {
  return {
    fullName: row.fullName,
    isSuperAdmin: row.isSuperAdmin,
    allBranches: row.allBranches,
    branchIds: row.branches.map((branch) => branch.branchId).sort(byCodeUnit),
  };
}

function byCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}
