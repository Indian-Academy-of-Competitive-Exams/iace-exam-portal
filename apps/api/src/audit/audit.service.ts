import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import { AUDIT_ACTOR_TYPE, type AuditAction, type AuditFeature } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { type AuditRowActionEvent } from '../common/events/event-catalog';

/** Owns `RowActionLog` — the only module that writes it. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(event: AuditRowActionEvent): Promise<void> {
    await this.prisma.rowActionLog.create({
      data: {
        feature: event.feature,
        entityId: event.entityId,
        action: event.action,
        actorType: event.actorType,
        actorId: event.actorId,
        changed: (event.changed ?? undefined) as Prisma.InputJsonValue | undefined,
        importLogId: event.importLogId,
      },
    });
  }

  /** One thin row per touched entity. `changed` is null by design — see the spec's Imports note. */
  async recordImportRows(
    importLogId: string,
    feature: AuditFeature,
    rows: readonly { entityId: string; action: AuditAction }[],
  ): Promise<void> {
    if (rows.length === 0) return;

    await this.prisma.rowActionLog.createMany({
      data: rows.map((row) => ({
        feature,
        entityId: row.entityId,
        action: row.action,
        actorType: AUDIT_ACTOR_TYPE.ADMIN,
        actorId: null,
        changed: undefined,
        importLogId,
      })),
    });
  }
}
