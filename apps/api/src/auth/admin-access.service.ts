import { Injectable } from '@nestjs/common';
import { type AdminAuthority } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AdminsService } from '../admins';

/** What an admin may do, read per request: a revoked grant or a deactivation bites on the next one. */
@Injectable()
export class AdminAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admins: AdminsService,
  ) {}

  /** Null when no such admin remains. A super admin bypasses, and a deactivated one reaches nothing, so neither needs grants. */
  async current(adminId: string): Promise<AdminAuthority | null> {
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: { isSuperAdmin: true, isActive: true },
    });
    if (!admin) return null;
    const holdsGrants = admin.isActive && !admin.isSuperAdmin;
    return {
      isSuperAdmin: admin.isSuperAdmin,
      isActive: admin.isActive,
      permissions: holdsGrants ? await this.admins.permissionsFor(adminId) : {},
    };
  }
}
