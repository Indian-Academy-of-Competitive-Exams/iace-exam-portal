import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { type AuditAction, type FieldDiff } from '@iace/contracts';

export interface AuditStore {
  changed: FieldDiff | null;
  entityId: string | null;
  importLogId: string | null;
  action: AuditAction | null;
}

/**
 * The diff a service computed for the write it is doing. Established per request by
 * `AuditContextMiddleware` — an interceptor cannot, because the handler runs on subscribe.
 */
@Injectable()
export class AuditContext {
  private readonly storage = new AsyncLocalStorage<AuditStore>();

  run<T>(fn: () => T): T {
    return this.storage.run({ changed: null, entityId: null, importLogId: null, action: null }, fn);
  }

  current(): AuditStore | undefined {
    return this.storage.getStore();
  }

  setChanged(diff: FieldDiff | null): void {
    const store = this.storage.getStore();
    if (store) store.changed = diff;
  }

  setEntityId(id: string): void {
    const store = this.storage.getStore();
    if (store) store.entityId = id;
  }

  setImportLogId(id: string): void {
    const store = this.storage.getStore();
    if (store) store.importLogId = id;
  }

  /** For a route whose action depends on what it found — `createSubTopic` links an existing row
   *  as often as it makes one, and the decorator cannot know which. */
  setAction(action: AuditAction): void {
    const store = this.storage.getStore();
    if (store) store.action = action;
  }
}
