import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DOMAIN_EVENTS } from '../src/common/events/event-catalog';

/**
 * docs/03 §6 makes this catalog the one place cross-module events are named. An event that
 * skips it is invisible to everyone reading the file.
 */
describe('domain event catalog', () => {
  it('names the audit event', () => {
    assert.equal(DOMAIN_EVENTS.AUDIT_ROW_ACTION, 'audit.row_action');
  });

  it('keeps every event name unique, so no listener answers two producers', () => {
    const names = Object.values(DOMAIN_EVENTS);
    assert.equal(new Set(names).size, names.length);
  });
});
