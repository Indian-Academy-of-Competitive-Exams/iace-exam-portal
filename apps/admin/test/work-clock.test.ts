import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { REVIEW_STATES } from '@iace/contracts';
import { awaitsViewer, WorkClock } from '../src/features/authoring/work-clock';

const ticks = (clock: WorkClock, count: number) => {
  for (let at = 0; at < count; at += 1) clock.tick();
};

describe('the clock on a question', () => {
  it('counts only the question on screen, and nothing while none is', () => {
    const clock = new WorkClock();
    ticks(clock, 5);
    clock.watch('q1');
    ticks(clock, 3);
    clock.watch('q2');
    ticks(clock, 2);

    assert.equal(clock.shown('q1', 0), 3);
    assert.equal(clock.shown('q2', 0), 2);
  });

  /** The failure this prevents: a re-read of the section adding the reported seconds to the clock a second time. */
  it('shows what the server held when the question was first drawn, plus every second since', () => {
    const clock = new WorkClock();
    clock.watch('q1');
    assert.equal(clock.shown('q1', 40), 40);
    ticks(clock, 10);
    clock.take(3600);

    assert.equal(clock.shown('q1', 50), 50);
  });

  it('hands over what is unreported once, and takes back a report that failed', () => {
    const clock = new WorkClock();
    clock.watch('q1');
    ticks(clock, 7);

    assert.deepEqual(clock.take(3600), [['q1', 7]]);
    assert.deepEqual(clock.take(3600), []);
    clock.giveBack('q1', 7);
    assert.deepEqual(clock.take(3600), [['q1', 7]]);
  });

  /** The failure this prevents: one report past the server's limit refused for ever, and the time with it. */
  it('reports no more than the limit at a time, and keeps the rest for the next report', () => {
    const clock = new WorkClock();
    clock.watch('q1');
    ticks(clock, 25);

    assert.deepEqual(clock.take(10), [['q1', 10]]);
    assert.deepEqual(clock.take(10), [['q1', 10]]);
    assert.deepEqual(clock.take(10), [['q1', 5]]);
  });

  it('holds a blank card’s time back until its save names the question it became', () => {
    const clock = new WorkClock();
    clock.watch('new');
    ticks(clock, 90);

    assert.deepEqual(clock.take(3600, 'new'), []);
    clock.move('new', 'q9');

    assert.equal(clock.shown('q9', 0), 90);
    assert.equal(clock.shown('new', 0), 0);
    assert.deepEqual(clock.take(3600, 'new'), [['q9', 90]]);
  });
});

describe('whose turn a question is', () => {
  const typist = { reading: false, fixing: true };
  const reader = { reading: true, fixing: false };

  /** The failure this prevents: a saved question's clock running on every time its typist scrolls past it. */
  it('is its typist’s only while it is sent back', () => {
    assert.equal(awaitsViewer(typist, REVIEW_STATES.UNCHECKED), false);
    assert.equal(awaitsViewer(typist, REVIEW_STATES.SENT_BACK), true);
    assert.equal(awaitsViewer(typist, REVIEW_STATES.FIXED), false);
    assert.equal(awaitsViewer(typist, REVIEW_STATES.CHECKED), false);
  });

  it('is its reader’s until it is checked or sent back, and again once it is fixed', () => {
    assert.equal(awaitsViewer(reader, REVIEW_STATES.UNCHECKED), true);
    assert.equal(awaitsViewer(reader, REVIEW_STATES.CHECKED), false);
    assert.equal(awaitsViewer(reader, REVIEW_STATES.SENT_BACK), false);
    assert.equal(awaitsViewer(reader, REVIEW_STATES.FIXED), true);
  });

  it('is nobody’s for a seat that cannot act yet', () => {
    const waiting = { reading: false, fixing: false };
    assert.equal(awaitsViewer(waiting, REVIEW_STATES.UNCHECKED), false);
    assert.equal(awaitsViewer(waiting, REVIEW_STATES.SENT_BACK), false);
  });
});
