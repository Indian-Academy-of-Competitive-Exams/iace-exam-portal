import { Injectable } from '@nestjs/common';
import {
  AppException,
  ErrorCodes,
  PERMISSION_LEVELS,
  type Admin as AdminDto,
  type AdminListQuery,
  type AdminPermissions,
  type CreateAdminBody,
  type Feature as FeatureDto,
  type PermissionGrantBody,
  type Paginated,
  type PermissionLevel,
  type StudentSyncResult,
  type UpdateAdminBody,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';

/** Both rows a feature always has. Created together, never separately. */
const BOTH_LEVELS = [PERMISSION_LEVELS.READ, PERMISSION_LEVELS.WRITE] as const;

interface AdminRow {
  id: string;
  email: string;
  fullName: string | null;
  isSuperAdmin: boolean;
  isActive: boolean;
  createdAt: Date;
}

interface FeatureRow {
  id: string;
  key: string;
  description: string | null;
  createdAt: Date;
  permissions: { level: PermissionLevel; adminIds: string[] }[];
}

@Injectable()
export class AdminsService {
  constructor(private readonly prisma: PrismaService) {}

  // ==========================================================================
  // The facade auth consumes
  // ==========================================================================

  /**
   * The grant map a token carries. One indexed read — the GIN index on `adminIds` is why
   * the list is denormalized — and WRITE wins if both levels are somehow held.
   */
  async permissionsFor(adminId: string): Promise<AdminPermissions> {
    const rows = await this.prisma.featurePermission.findMany({
      where: { adminIds: { has: adminId } },
      select: { level: true, feature: { select: { key: true } } },
    });

    // Every key is carried, including ones no controller checks yet.
    const permissions: AdminPermissions = {};
    for (const row of rows) {
      const key = row.feature.key;
      if (permissions[key] === PERMISSION_LEVELS.WRITE) continue;
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

    const row = await this.prisma.admin.create({
      data: {
        email: input.email,
        fullName: input.fullName ?? null,
        isSuperAdmin: input.isSuperAdmin,
        createdById,
      },
    });
    // A brand-new admin holds nothing until a grant is made, and a super admin
    // never needs one.
    return this.toAdminDto(row, {});
  }

  async update(id: string, input: UpdateAdminBody): Promise<AdminDto> {
    // requireAdmin, not requireActive: renaming a deactivated admin, or making
    // one a super admin before switching them back on, are both reasonable.
    await this.requireAdmin(id);
    const row = await this.prisma.admin.update({
      where: { id },
      data: {
        ...(input.fullName === undefined ? {} : { fullName: input.fullName }),
        ...(input.isSuperAdmin === undefined ? {} : { isSuperAdmin: input.isSuperAdmin }),
      },
    });
    return this.toAdminDto(row, await this.permissionsFor(id));
  }

  /**
   * Deactivating prunes every grant in the same transaction as the flag: `adminIds` has no
   * foreign key, so nothing else removes the id. Reactivating does NOT give them back.
   */
  async setActive(id: string, isActive: boolean, actingAdminId: string): Promise<AdminDto> {
    if (!isActive && id === actingAdminId) {
      // Switching yourself off is undone only by another super admin — or, if
      // you were the last one, only with database access.
      throw new AppException(ErrorCodes.CONFLICT, 'You cannot deactivate your own account');
    }
    await this.requireAdmin(id);

    if (isActive) {
      const row = await this.prisma.admin.update({ where: { id }, data: { isActive: true } });
      // Read the grants back rather than assuming none: a super admin may have
      // granted something while the account was switched off.
      return this.toAdminDto(row, await this.permissionsFor(id));
    }

    // The update returns the row, so the transaction hands back what to report — no second read, and
    // no chance of reporting a state that something else changed in between.
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.admin.update({ where: { id }, data: { isActive: false } });

      const holding = await tx.featurePermission.findMany({
        where: { adminIds: { has: id } },
        select: { id: true, adminIds: true },
      });
      for (const perm of holding) {
        await tx.featurePermission.update({
          where: { id: perm.id },
          data: { adminIds: perm.adminIds.filter((adminId) => adminId !== id) },
        });
      }
      return updated;
    });

    return this.toAdminDto(row, {});
  }

  // ==========================================================================
  // Features
  // ==========================================================================

  async listFeatures(): Promise<FeatureDto[]> {
    const rows = await this.prisma.feature.findMany({
      orderBy: [{ key: 'asc' }],
      include: { permissions: { select: { level: true, adminIds: true } } },
    });
    return rows.map((row) => this.toFeatureDto(row));
  }

  /** Register a feature, with BOTH its permission rows. */
  async createFeature(input: { key: string; description?: string }): Promise<FeatureDto> {
    const clash = await this.prisma.feature.findUnique({ where: { key: input.key } });
    if (clash) {
      throw new AppException(ErrorCodes.CONFLICT, 'That feature is already registered', {
        fieldErrors: { key: ['That feature is already registered'] },
      });
    }

    const row = await this.prisma.feature.create({
      data: {
        key: input.key,
        // The column stays, always equal to the key: one value, so the two can
        // never disagree about what a feature is called.
        name: input.key,
        description: input.description ?? null,
        permissions: { create: BOTH_LEVELS.map((level) => ({ level })) },
      },
      include: { permissions: { select: { level: true, adminIds: true } } },
    });
    return this.toFeatureDto(row);
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

  /** Add or remove one admin id in one feature+level row. */
  private async changeGrant(
    input: PermissionGrantBody,
    action: 'add' | 'remove',
  ): Promise<FeatureDto> {
    const feature = await this.prisma.feature.findUnique({ where: { key: input.featureKey } });
    if (!feature) {
      throw new AppException(
        ErrorCodes.NOT_FOUND,
        'That feature is not registered yet — create it first',
      );
    }
    await this.requireActive(input.adminId);

    await this.prisma.$transaction(async (tx) => {
      const row = await tx.featurePermission.findUnique({
        where: { featureId_level: { featureId: feature.id, level: input.level } },
        select: { id: true, adminIds: true },
      });
      if (!row) throw new AppException(ErrorCodes.NOT_FOUND, 'That permission row is missing');

      const without = row.adminIds.filter((id) => id !== input.adminId);
      await tx.featurePermission.update({
        where: { id: row.id },
        // Filtering first makes granting idempotent: granting twice leaves one
        // entry, not two, and a duplicate would survive a single revoke.
        data: { adminIds: action === 'add' ? [...without, input.adminId] : without },
      });
    });

    const updated = await this.prisma.feature.findUniqueOrThrow({
      where: { id: feature.id },
      include: { permissions: { select: { level: true, adminIds: true } } },
    });
    return this.toFeatureDto(updated);
  }

  // ==========================================================================
  // Student sync — trigger only
  // ==========================================================================

  /** Pull students from the institute's main portal. */
  // No await yet — the body is a stub. `async` stays so the signature does not
  // change when the real fetch lands.
  async triggerStudentSync(): Promise<StudentSyncResult> {
    return {
      startedAt: new Date().toISOString(),
      syncedCount: null,
      status: 'NOT_IMPLEMENTED',
      message: 'Student sync is not implemented yet. Nothing was changed.',
    };
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  /** Exists at all — the right check when the point is to change their state. */
  private async requireAdmin(id: string): Promise<void> {
    const admin = await this.prisma.admin.findUnique({ where: { id }, select: { id: true } });
    if (!admin) throw new AppException(ErrorCodes.NOT_FOUND, 'Admin not found');
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

    const rows = await this.prisma.featurePermission.findMany({
      where: { adminIds: { hasSome: adminIds } },
      select: { level: true, adminIds: true, feature: { select: { key: true } } },
    });

    for (const row of rows) {
      const key = row.feature.key;
      for (const adminId of row.adminIds) {
        if (!adminIds.includes(adminId)) continue;
        const current = byAdmin.get(adminId) ?? {};
        if (current[key] !== PERMISSION_LEVELS.WRITE) current[key] = row.level;
        byAdmin.set(adminId, current);
      }
    }
    return byAdmin;
  }

  private toAdminDto(row: AdminRow, permissions: AdminPermissions): AdminDto {
    return {
      id: row.id,
      email: row.email,
      fullName: row.fullName,
      isSuperAdmin: row.isSuperAdmin,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      permissions,
    };
  }

  private toFeatureDto(row: FeatureRow): FeatureDto {
    return {
      id: row.id,
      key: row.key,
      description: row.description,
      createdAt: row.createdAt.toISOString(),
      grants: Object.fromEntries(
        BOTH_LEVELS.map((level) => [
          level,
          row.permissions.find((p) => p.level === level)?.adminIds ?? [],
        ]),
      ) as FeatureDto['grants'],
    };
  }
}
