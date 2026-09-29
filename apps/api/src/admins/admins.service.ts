import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import {
  ActorTypes,
  ADMIN_ROLES,
  AppException,
  ErrorCodes,
  FEATURES,
  FEATURE_KEY_VALUES,
  PERMISSION_LEVELS,
  ROLE_PERMISSION_PRESET,
  fieldDiff,
  satisfiesLevel,
  type Admin as AdminDto,
  type AdminIdentity,
  type AdminListQuery,
  type AdminPermissions,
  type AdminRole,
  type CreateAdminBody,
  type Feature as FeatureDto,
  type FeatureKey,
  type Paginated,
  type PermissionChanges,
  type PermissionLevel,
  type UpdateAdminBody,
} from '@iace/contracts';
import { pageArgs, paged } from '../common/pagination';
import { PrismaService, TX_LIMITS } from '../prisma/prisma.service';
import { AuditContext } from '../audit';
import { DomainEventBus, DOMAIN_EVENTS } from '../common/events';
import { everyTermMatches } from '../common/search-terms';

/** The two levels a key can be held at. A feature always reports both lists. */
const BOTH_LEVELS = [PERMISSION_LEVELS.READ, PERMISSION_LEVELS.WRITE] as const;

interface AdminRow {
  id: string;
  email: string;
  fullName: string | null;
  role: AdminRole;
  isSuperAdmin: boolean;
  isActive: boolean;
  createdAt: Date;
}

/** What an admin's audit diff covers — every column the admin screens can change. */
export const AUDITED_ADMIN_FIELDS = ['fullName', 'role', 'isSuperAdmin'] as const;

/** The single column the toggle route moves — the same `fieldDiff` definition of "changed". */
const AUDITED_ACTIVE_FIELDS = ['isActive'] as const;

@Injectable()
export class AdminsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditContext: AuditContext,
    private readonly events: DomainEventBus,
  ) {}

  // ==========================================================================
  // The facade auth consumes
  // ==========================================================================

  /** Who an admin is and what they may do right now, in one read — the guard and the signed-in identity both ask here. */
  async identityOf(adminId: string): Promise<AdminIdentity | null> {
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: {
        id: true,
        email: true,
        fullName: true,
        isSuperAdmin: true,
        isActive: true,
        permissions: { select: { featureKey: true, level: true } },
      },
    });
    if (!admin) return null;
    // A deactivated admin reaches nothing — not even the bypass — and a super admin needs no grants.
    return {
      actor: ActorTypes.ADMIN,
      id: admin.id,
      email: admin.email,
      fullName: admin.fullName,
      isActive: admin.isActive,
      isSuperAdmin: admin.isActive && admin.isSuperAdmin,
      permissions: admin.isActive && !admin.isSuperAdmin ? permissionsIn(admin.permissions) : {},
    };
  }

  /** One admin's explicit grants, whatever their standing. */
  async permissionsFor(adminId: string): Promise<AdminPermissions> {
    return (await this.grantsByAdmin([adminId])).get(adminId) ?? {};
  }

  /** Id and name only, for a picker that must not leak the directory `admins.list` guards. */
  async holdersOf(
    key: FeatureKey,
    level: PermissionLevel,
  ): Promise<{ id: string; fullName: string | null; role: AdminRole }[]> {
    const rows = await this.prisma.admin.findMany({
      where: { isActive: true },
      select: { id: true, fullName: true, role: true },
    });
    const grants = await this.grantsByAdmin(rows.map((row) => row.id));
    return rows.filter((row) => satisfiesLevel(grants.get(row.id)?.[key], level));
  }

  // ==========================================================================
  // Admins
  // ==========================================================================

  /** Returns the full Paginated shape, not just items+total. */
  async list(query: AdminListQuery): Promise<Paginated<AdminDto>> {
    const where = {
      ...(query.activeOnly === undefined ? {} : { isActive: query.activeOnly }),
      ...everyTermMatches<Prisma.AdminWhereInput>(query.q, (term) => [
        { email: { contains: term, mode: 'insensitive' } },
        { fullName: { contains: term, mode: 'insensitive' } },
      ]),
    };

    const [rows, total] = await Promise.all([
      this.prisma.admin.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        ...pageArgs(query),
      }),
      this.prisma.admin.count({ where }),
    ]);

    // One grants query for the whole page rather than one per row: a list of 50 admins would otherwise be 51 queries.
    const grants = await this.grantsByAdmin(rows.map((row) => row.id));
    return paged(
      query,
      rows.map((row) => this.toAdminDto(row, grants.get(row.id) ?? {})),
      total,
    );
  }

  async create(input: CreateAdminBody, createdById: string): Promise<AdminDto> {
    // Pre-checked like every other create here; the global filter still maps a racing P2002 to the same CONFLICT, so the check is for the message rather than for correctness.
    const clash = await this.prisma.admin.findUnique({ where: { email: input.email } });
    if (clash) {
      throw new AppException(ErrorCodes.CONFLICT, 'An admin with that email already exists', {
        fieldErrors: { email: ['An admin with that email already exists'] },
      });
    }

    const preset = ROLE_PERMISSION_PRESET[input.role];

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.admin.create({
        data: {
          email: input.email,
          fullName: input.fullName ?? null,
          role: input.role,
          // Derived, never asked twice: the role IS whether they bypass the checks.
          isSuperAdmin: input.role === ADMIN_ROLES.SUPER_ADMIN,
          createdById,
        },
      });
      const grants = Object.entries(preset) as [FeatureKey, PermissionLevel][];
      if (grants.length > 0) {
        await tx.adminFeaturePermission.createMany({
          data: grants.map(([featureKey, level]) => ({ adminId: created.id, featureKey, level })),
        });
      }
      return created;
    }, TX_LIMITS.SHORT);

    // The role's opening grants, which the Permissions screen is free to override afterwards.
    return this.toAdminDto(row, preset);
  }

  async update(id: string, input: UpdateAdminBody): Promise<AdminDto> {
    // requireAdmin, not an active check: renaming a deactivated admin, or making one a super admin before switching them back on, are both reasonable.
    const before = await this.requireAdmin(id);

    const row = await this.prisma.admin.update({
      where: { id },
      data: {
        ...(input.fullName === undefined ? {} : { fullName: input.fullName }),
        ...(input.role === undefined
          ? {}
          : { role: input.role, isSuperAdmin: input.role === ADMIN_ROLES.SUPER_ADMIN }),
      },
    });

    this.auditContext.setChanged(
      fieldDiff(auditFieldsOf(before), auditFieldsOf(row), AUDITED_ADMIN_FIELDS),
    );

    return this.toAdminDto(row, await this.permissionsFor(id));
  }

  /** Deactivating prunes every grant in the same transaction as the flag. Reactivating does NOT give them back. */
  async setActive(id: string, isActive: boolean, actingAdminId: string): Promise<AdminDto> {
    if (!isActive && id === actingAdminId) {
      // Switching yourself off is undone only by another super admin — or, if you were the last one, only with database access.
      throw new AppException(ErrorCodes.CONFLICT, 'You cannot deactivate your own account');
    }
    const before = await this.requireAdmin(id);

    if (isActive) {
      const row = await this.prisma.admin.update({
        where: { id },
        data: { isActive: true },
      });
      this.auditContext.setChanged(
        fieldDiff(before, { ...before, isActive: true }, AUDITED_ACTIVE_FIELDS),
      );
      // Read the grants back rather than assuming none: a super admin may have granted something while the account was switched off.
      return this.toAdminDto(row, await this.permissionsFor(id));
    }

    // The update returns the row, so the transaction hands back what to report — no second read, and no chance of reporting a state that something else changed in between.
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.admin.update({
        where: { id },
        data: { isActive: false },
      });
      await tx.adminFeaturePermission.deleteMany({ where: { adminId: id } });
      return updated;
    }, TX_LIMITS.SHORT);

    this.auditContext.setChanged(
      fieldDiff(before, { ...before, isActive: false }, AUDITED_ACTIVE_FIELDS),
    );
    // Auth revokes their sessions on this, so the switch-off holds now rather than at token expiry.
    this.events.emit(DOMAIN_EVENTS.ADMIN_DEACTIVATED, { adminId: id });
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

  /** One admin's changes in one transaction: a level sets the feature, null removes it, an absent key is left alone. */
  async setPermissions(adminId: string, changes: PermissionChanges): Promise<AdminDto> {
    const keys = Object.keys(changes) as FeatureKey[];
    const { admin, before } = await this.prisma.$transaction(async (tx) => {
      // Locked, so a deactivation cannot land between the check and the writes and have its pruned grants written back.
      await tx.$queryRaw`SELECT 1 FROM "Admin" WHERE "id" = ${adminId}::uuid FOR NO KEY UPDATE`;
      const admin = await tx.admin.findUnique({ where: { id: adminId } });
      if (!admin?.isActive) throw new AppException(ErrorCodes.NOT_FOUND, 'Admin not found');
      const before = (await this.grantsByAdmin([adminId], tx)).get(adminId) ?? {};

      const removed = keys.filter((key) => changes[key] === null);
      await tx.adminFeaturePermission.deleteMany({
        where: { adminId, featureKey: { in: removed } },
      });
      for (const key of keys) {
        const level = changes[key];
        if (!level) continue;
        await tx.adminFeaturePermission.upsert({
          where: { adminId_featureKey: { adminId, featureKey: key } },
          create: { adminId, featureKey: key, level },
          update: { level },
        });
      }
      return { admin, before };
    }, TX_LIMITS.SHORT);

    const held = Object.fromEntries(keys.map((key) => [key, before[key] ?? null]));
    this.auditContext.setPatchDiff(fieldDiff(held, changes, keys));
    return this.toAdminDto(admin, await this.permissionsFor(adminId));
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  /** Exists at all — the right check when the point is to change their state. */
  private async requireAdmin(id: string): Promise<AdminRow> {
    const admin = await this.prisma.admin.findUnique({ where: { id } });
    if (!admin) throw new AppException(ErrorCodes.NOT_FOUND, 'Admin not found');
    return admin;
  }

  /** Permissions for many admins in one query — see the note in `list`. */
  private async grantsByAdmin(
    adminIds: string[],
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<Map<string, AdminPermissions>> {
    const byAdmin = new Map<string, AdminPermissions>();
    if (adminIds.length === 0) return byAdmin;

    const rows = await db.adminFeaturePermission.findMany({
      where: { adminId: { in: adminIds } },
      select: { adminId: true, featureKey: true, level: true },
    });

    for (const row of rows) {
      byAdmin.set(row.adminId, { ...byAdmin.get(row.adminId), ...permissionsIn([row]) });
    }
    return byAdmin;
  }

  private toAdminDto(row: AdminRow, permissions: AdminPermissions): AdminDto {
    return {
      id: row.id,
      email: row.email,
      fullName: row.fullName,
      role: row.role,
      isSuperAdmin: row.isSuperAdmin,
      isActive: row.isActive,
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

function permissionsIn(
  rows: readonly { featureKey: string; level: PermissionLevel }[],
): AdminPermissions {
  return Object.fromEntries(
    rows.flatMap((row) => {
      const key = asFeatureKey(row.featureKey);
      return key === null ? [] : [[key, row.level] as const];
    }),
  );
}

function auditFieldsOf(row: AdminRow): {
  fullName: string | null;
  role: AdminRole;
  isSuperAdmin: boolean;
} {
  return { fullName: row.fullName, role: row.role, isSuperAdmin: row.isSuperAdmin };
}
