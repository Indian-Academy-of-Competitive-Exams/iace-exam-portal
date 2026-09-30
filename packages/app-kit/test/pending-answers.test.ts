import test from 'node:test';
import assert from 'node:assert/strict';
import { ANSWER_STATE, SAVE_BATCH_MAX, type AnswerChange } from '@iace/contracts';
import { createPendingAnswers } from '../src/exam/pending-answers';
import { fakeStorage } from './support/fake-storage';

const KEY = 'test.queued.attempt-1';

const changeFor = (questionId: string, selectedOptionId: string): AnswerChange => ({
  questionId,
  state: ANSWER_STATE.ANSWERED,
  selectedOptionId,
  typedAnswer: null,
  timeSpentSec: 1,
  firstActionAt: '2026-09-30T04:00:00.000Z',
});

const queueOn = (storage = fakeStorage()) => createPendingAnswers(storage, KEY);

/** The failure this prevents: the ack for the copy that flew taking the newer one out with it. */
test('an acknowledgement removes only the copy its batch carried', () => {
  const queue = queueOn();
  queue.put(changeFor('q1', 'opt-1'));
  const batch = queue.batch();

  queue.put(changeFor('q1', 'opt-2'));
  queue.acknowledge(batch);

  assert.equal(queue.anyUnsent(), true);
  assert.deepEqual(
    queue.changes().map((change) => change.selectedOptionId),
    ['opt-2'],
  );
});

test('an acknowledgement settles the copy it did carry', () => {
  const queue = queueOn();
  queue.put(changeFor('q1', 'opt-1'));
  queue.putSection('sec-1', { remainingSec: 60, closed: false });

  queue.acknowledge(queue.batch());

  assert.equal(queue.anyUnsent(), false);
  assert.equal(queue.size(), 0);
});

test('a section rewritten while its save flew is not settled by that save', () => {
  const queue = queueOn();
  queue.putSection('sec-1', { remainingSec: 60, closed: false });
  const batch = queue.batch();

  queue.putSection('sec-1', { remainingSec: 0, closed: true });
  queue.acknowledge(batch);

  assert.equal(queue.anyUnsent(), true);
  assert.deepEqual(queue.batch().sections['sec-1'], { remainingSec: 0, closed: true });
});

/** The failure this prevents: a backlog past the contract's cap refused as a 400 by every save, forever. */
test('a batch is capped, and the backlog behind it goes up in the ones after', () => {
  const queue = queueOn();
  const backlog = SAVE_BATCH_MAX + 5;
  for (let seat = 0; seat < backlog; seat += 1) queue.put(changeFor(`q${seat}`, 'opt-1'));

  const delivered = new Set<string>();
  while (queue.anyUnsent()) {
    const batch = queue.batch();
    assert.ok(batch.answers.length <= SAVE_BATCH_MAX, `within the cap: ${batch.answers.length}`);
    for (const change of batch.answers) delivered.add(change.questionId);
    queue.acknowledge(batch);
  }

  assert.equal(delivered.size, backlog);
});

test('what a save never delivered is read back from the store by the next queue', () => {
  const storage = fakeStorage();
  queueOn(storage).put(changeFor('q1', 'opt-1'));

  const reloaded = queueOn(storage);
  assert.deepEqual(
    reloaded.changes().map((change) => change.questionId),
    ['q1'],
  );

  reloaded.clear();
  assert.equal(storage.getItem(KEY), null, 'a handed-in paper leaves nothing on the device');
});
