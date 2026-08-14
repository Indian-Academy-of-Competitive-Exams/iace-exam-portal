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
  type FeatureKey,
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
   * What this admin has been granted, as the map the token carries.
   *
   * One indexed read: the GIN index on `adminIds` makes "rows whose array
   * contains X" cheap, which is the whole reason the grant list is
   * denormalized. Called on every login and refresh, so it must stay one query.
   *
   * WRITE wins over READ when both are somehow granted. That should not happen
   * — the UI grants one level — but resolving it here means a duplicated grant
   * degrades to the more permissive single answer rather than to whichever row
   * the database happened to return first, which would be non-deterministic.
   */
  async permissionsFor(adminId: string): Promise<AdminPermissions> {
    const rows = await this.prisma.featurePermission.findMany({
      where: { adminIds: { has: adminId } },
      select: { level: true, feature: { select: { key: true } } },
    });

    // Every key is carried, including ones no controller checks yet. The set is
    // open — a super admin registers sectors as the product grows — so
    // filtering to the code's known keys would silently drop a grant that was
    // deliberately made, and drop it again on every refresh.
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

  /**
   * Returns the full Paginated shape, not just items+total.
   *
   * `isPaginated` in the response interceptor requires all four keys before it
   * will split the payload into data + meta. Miss one and the whole object is
   * wrapped as `data`, the client validates an object against an array schema,
   * and the only symptom is "Unexpected response shape from API" — which points
   * at the client rather than at the handler that actually got it wrong.
   */
  async list(query: AdminListQuery): Promise<Paginated<AdminDto>> {
    const where = {
      deletedAt: null,
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
    // Pre-checked like every other create here; the global filter still maps a
    // racing P2002 to the same CONFLICT, so the check is for the message rather
    // than for correctness. The email arrives lowercased from the schema, so
    // this catches the real duplicate and not a differently-cased one.
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
    await this.requireActive(id);
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
   * Soft-delete, and prune every grant in the same transaction.
   *
   * The pruning is the point. `adminIds` is a denormalized array with no
   * foreign key, so nothing else would ever remove the id: a deactivated
   * admin's grants would sit there indefinitely and come back the moment the
   * account was reactivated — silently re-granting access somebody revoked by
   * deactivating them. Doing it in one transaction means there is no window in
   * which the account is gone but the grants are not.
   */
  async deactivate(id: string, actingAdminId: string): Promise<void> {
    if (id === actingAdminId) {
      // Locking yourself out is recoverable only with database access, so it is
      // refused rather than confirmed.
      throw new AppException(ErrorCodes.CONFLICT, 'You cannot deactivate your own account');
    }
    await this.requireActive(id);

    await this.prisma.$transaction(async (tx) => {
      await tx.admin.update({
        where: { id },
        data: { isActive: false, deletedAt: new Date() },
      });

      const holding = await tx.featurePermission.findMany({
        where: { adminIds: { has: id } },
        select: { id: true, adminIds: true },
      });
      for (const row of holding) {
        await tx.featurePermission.update({
          where: { id: row.id },
          data: { adminIds: row.adminIds.filter((adminId) => adminId !== id) },
        });
      }
    });
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

  /**
   * Register a feature, with BOTH its permission rows.
   *
   * One transaction, because a feature with only a READ row is a feature whose
   * WRITE grants silently cannot be made — the grant path updates an existing
   * row and would have nothing to update. Creating them together means a grant
   * is always an array update and never has to consider whether the row exists.
   */
  async createFeature(input: { key: FeatureKey; description?: string }): Promise<FeatureDto> {
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

  /**
   * Add or remove one admin id in one feature+level row.
   *
   * Read-modify-write inside a transaction rather than an array push: two
   * grants issued at the same moment would otherwise last-write-wins and one
   * would vanish. The row is locked for the duration, which is fine — this is
   * an administrative action measured in clicks per week, not per second.
   */
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

  /**
   * Pull students from the institute's main portal.
   *
   * TODO: implement the fetch. Everything around this method is finished —
   * contracts, route, guard, client and button — so landing the real sync is a
   * change to this body and nothing else. It deliberately does NOT touch the
   * bulk importer, which is a separate, working path.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
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

  private async requireActive(id: string): Promise<void> {
    const admin = await this.prisma.admin.findFirst({
      where: { id, deletedAt: null },
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
