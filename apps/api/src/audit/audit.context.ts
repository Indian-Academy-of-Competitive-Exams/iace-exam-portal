import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { type FieldDiff } from '@iace/contracts';

export interface AuditStore {
  changed: FieldDiff | null;
  entityId: string | null;
  /** A patch measured against every column it writes, and nothing moved: there is no row to log. */
  unchanged: boolean;
}

/**
 * The diff a service computed for the write it is doing. Established per request by
 * `AuditContextMiddleware` — an interceptor cannot, because the handler runs on subscribe.
 */
@Injectable()
export class AuditContext {
  private readonly storage = new AsyncLocalStorage<AuditStore>();

  run<T>(fn: () => T): T {
    return this.storage.run({ changed: null, entityId: null, unchanged: false }, fn);
  }

  current(): AuditStore | undefined {
    return this.storage.getStore();
  }

  setChanged(diff: FieldDiff | null): void {
    const store = this.storage.getStore();
    if (store) store.changed = diff;
  }

  /** Only where `diff` covers every column the write can touch — a null one then means a no-op save. */
  setPatchDiff(diff: FieldDiff | null): void {
    const store = this.storage.getStore();
    if (!store) return;
    store.changed = diff;
    store.unchanged = diff === null;
  }

  setEntityId(id: string): void {
    const store = this.storage.getStore();
    if (store) store.entityId = id;
  }
}
