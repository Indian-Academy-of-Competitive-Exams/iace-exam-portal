import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
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
}
