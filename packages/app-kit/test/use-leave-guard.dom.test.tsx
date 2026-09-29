import test from 'node:test';
import assert from 'node:assert/strict';
import { act, renderHook } from '@testing-library/react';
import { useLeaveGuard } from '../browser/use-leave-guard';

const asksBeforeLeaving = (): boolean => {
  const leaving = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(leaving);
  return leaving.defaultPrevented;
};

/** The failure this prevents: Continue here, a navigation the page chose, stopped by the browser's "Leave site?". */
test('asks before closing with answers unsent, but lets the page go once released', (t) => {
  const { result, unmount } = renderHook(() =>
    useLeaveGuard(
      () => true,
      () => undefined,
    ),
  );
  t.after(unmount);

  assert.equal(asksBeforeLeaving(), true, 'closing the tab still asks');
  act(() => result.current());
  assert.equal(asksBeforeLeaving(), false);
});
