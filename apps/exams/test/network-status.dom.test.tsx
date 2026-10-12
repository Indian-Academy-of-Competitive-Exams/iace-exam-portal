import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { act, cleanup, renderHook } from '@testing-library/react';
import './support/offline';
import { useNetworkStatus } from '../src/features/exam/use-network-status';

const onlineDescriptor = Object.getOwnPropertyDescriptor(navigator, 'onLine');

afterEach(() => {
  cleanup();
  if (onlineDescriptor) Object.defineProperty(navigator, 'onLine', onlineDescriptor);
});

describe('the exam network status', () => {
  it('tracks disconnect and reconnect events', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const { result } = renderHook(() => useNetworkStatus());

    assert.equal(result.current, false);

    act(() => window.dispatchEvent(new Event('online')));
    assert.equal(result.current, true);

    act(() => window.dispatchEvent(new Event('offline')));
    assert.equal(result.current, false);
  });
});
