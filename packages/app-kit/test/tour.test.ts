import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act, renderHook } from '@testing-library/react';
import { seenTours, useTourRun, type TourStep } from '../src/tour';
import { fakeStorage } from './support/fake-storage';

const KEY = 'iace.test.tours';

const STEPS: readonly TourStep[] = [
  { target: 'list', title: 'Your tests', body: 'Every test the institute has opened to you.' },
  { target: 'begin', title: 'Begin', body: 'Opens the instructions, not the paper.' },
  { target: 'series', title: 'Series', body: 'A series holds the tests it was built from.' },
];

describe('seenTours', () => {
  it('has not seen a tour nobody marked', () => {
    assert.equal(seenTours(fakeStorage(), KEY).has('tests'), false);
  });

  it('keeps a marked tour seen for a reader made later', () => {
    const storage = fakeStorage();
    seenTours(storage, KEY).mark('tests');

    assert.equal(seenTours(storage, KEY).has('tests'), true);
  });

  /** One key holding the set, so a tour added later needs no migration. */
  it('marks one tour without marking another', () => {
    const seen = seenTours(fakeStorage(), KEY);
    seen.mark('tests');

    assert.equal(seen.has('performance'), false);
  });

  it('marks a second tour without losing the first', () => {
    const seen = seenTours(fakeStorage(), KEY);
    seen.mark('tests');
    seen.mark('performance');

    assert.deepEqual([seen.has('tests'), seen.has('performance')], [true, true]);
  });

  it('writes under the key it was given, and no other', () => {
    const storage = fakeStorage();
    seenTours(storage, KEY).mark('tests');

    assert.deepEqual([...storage.entries.keys()], [KEY]);
  });

  it('reads a half-written value as nothing seen, and recovers on the next mark', () => {
    const storage = fakeStorage();
    storage.setItem(KEY, '{not json');
    const seen = seenTours(storage, KEY);

    assert.equal(seen.has('tests'), false);
    seen.mark('tests');
    assert.equal(seen.has('tests'), true);
  });

  it('reads a value of the wrong shape as nothing seen', () => {
    const storage = fakeStorage();
    storage.setItem(KEY, '{"tests":true}');

    assert.equal(seenTours(storage, KEY).has('tests'), false);
  });
});

describe('useTourRun', () => {
  it('opens on the first step of the run', () => {
    const { result } = renderHook(() => useTourRun());
    act(() => result.current.open(STEPS));

    assert.deepEqual(
      [result.current.step?.title, result.current.index, result.current.count],
      ['Your tests', 0, 3],
    );
  });

  it('holds no step before it is opened', () => {
    const { result } = renderHook(() => useTourRun());

    assert.equal(result.current.step, null);
  });

  it('advances to the next step', () => {
    const { result } = renderHook(() => useTourRun());
    act(() => result.current.open(STEPS));
    act(() => result.current.next());

    assert.deepEqual([result.current.step?.title, result.current.index], ['Begin', 1]);
  });

  it('closes rather than advancing past the last step', () => {
    const { result } = renderHook(() => useTourRun());
    act(() => result.current.open(STEPS));
    act(() => result.current.next());
    act(() => result.current.next());
    assert.equal(result.current.isLast, true);

    act(() => result.current.next());
    assert.equal(result.current.step, null);
  });

  it('stays on the first step when there is nowhere back to', () => {
    const { result } = renderHook(() => useTourRun());
    act(() => result.current.open(STEPS));
    act(() => result.current.back());

    assert.deepEqual([result.current.step?.title, result.current.index], ['Your tests', 0]);
  });

  it('steps back', () => {
    const { result } = renderHook(() => useTourRun());
    act(() => result.current.open(STEPS));
    act(() => result.current.next());
    act(() => result.current.back());

    assert.equal(result.current.step?.title, 'Your tests');
  });

  it('closes on demand, and reopens at the start', () => {
    const { result } = renderHook(() => useTourRun());
    act(() => result.current.open(STEPS));
    act(() => result.current.next());
    act(() => result.current.close());
    assert.equal(result.current.count, 0);

    act(() => result.current.open(STEPS));
    assert.deepEqual([result.current.step?.title, result.current.index], ['Your tests', 0]);
  });

  it('is on its last step when a run holds only one', () => {
    const { result } = renderHook(() => useTourRun());
    act(() => result.current.open(STEPS.slice(0, 1)));

    assert.deepEqual([result.current.isLast, result.current.count], [true, 1]);
  });
});
