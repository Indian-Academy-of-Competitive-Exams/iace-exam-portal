import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANSWER_STATE,
  QUESTION_TIME_MAX_SEC,
  SAVE_BATCH_MAX,
  type AnswerChange,
} from '@iace/contracts';
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

/** The failure this prevents: a stored value of the wrong shape throwing on mount, so the exam screen never opens. */
test('a stored value that is not a list of changes opens the paper with nothing queued', () => {
  for (const held of ['{}', 'null', '"queued"', '7', 'not json', '[null, 3, {"questionId": 9}]']) {
    const storage = fakeStorage();
    storage.setItem(KEY, held);

    const queue = queueOn(storage);

    assert.deepEqual(queue.changes(), [], held);
    assert.equal(queue.anyUnsent(), false, held);
  }
});

/** The failure this prevents: one copy no save would take, queued beside the rest and refusing every save after it. */
test('a stored list keeps the changes a save would take and drops the rest', () => {
  const storage = fakeStorage();
  storage.setItem(KEY, JSON.stringify([changeFor('q1', 'opt-1'), { questionId: 'q2' }]));

  assert.deepEqual(queueOn(storage).changes(), [changeFor('q1', 'opt-1')]);
});

/** The failure this prevents: a copy stored before the cap was kept, read back and refusing every save from this device. */
test('a stored change past the time cap is read back at the cap, neither dropped nor resent as it was', () => {
  const storage = fakeStorage();
  const over = { ...changeFor('q1', 'opt-1'), timeSpentSec: QUESTION_TIME_MAX_SEC * 2 };
  storage.setItem(KEY, JSON.stringify([over]));

  assert.deepEqual(queueOn(storage).changes(), [{ ...over, timeSpentSec: QUESTION_TIME_MAX_SEC }]);
});
