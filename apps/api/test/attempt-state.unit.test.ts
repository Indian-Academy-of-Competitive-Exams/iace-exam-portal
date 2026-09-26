import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ANSWER_STATE, type AnswerChange, type LiveAnswer } from '@iace/contracts';
import { AttemptStateService } from '../src/attempts/attempt-state.service';
import { type PaperSheetService } from '../src/attempts/paper-sheet.service';
import { type PrismaService } from '../src/prisma/prisma.service';
import { redisKeys } from '../src/redis/redis.keys';
import { FakeRedis } from './support/fakes';
import {
  applyBatch,
  awayMs,
  creditedEndsAt,
  creditedSections,
  creditMs,
  heldIn,
  isAbandoned,
  isInTime,
  isStale,
  PAUSE_CREDIT_CAP_SEC,
  PAUSE_LIMIT_SEC,
  PRESENT_GRACE_SEC,
  packHeld,
  pendingAfter,
  SAVE_GRACE_SEC,
  stateOf,
  type HeldState,
} from '../src/attempts/attempt-state';

const ENDS_AT = '2026-09-01T05:30:00.000Z';

const held = (over: Partial<HeldState> = {}): HeldState => ({
  attemptId: 'att_1',
  studentId: 'stu_1',
  testId: 'test_1',
  startedAt: '2026-09-01T05:00:00.000Z',
  endsAt: ENDS_AT,
  revision: 0,
  answers: {},
  sections: {},
  ...over,
});

const change = (over: Partial<AnswerChange> = {}): AnswerChange => ({
  questionId: 'q1',
  state: ANSWER_STATE.ANSWERED,
  selectedOptionId: 'opt_a',
  typedAnswer: null,
  timeSpentSec: 10,
  ...over,
});

describe('stateOf — the truth table the bottom bar can produce', () => {
  it('is ANSWERED when an option is chosen and it is not marked', () => {
    assert.equal(stateOf(change()), ANSWER_STATE.ANSWERED);
  });

  /** Marking keeps the answer: it is a flag on top of one, not a state instead of one. */
  it('is ANSWERED_MARKED when a chosen answer is also marked', () => {
    assert.equal(
      stateOf(change({ state: ANSWER_STATE.MARKED_REVIEW })),
      ANSWER_STATE.ANSWERED_MARKED,
    );
  });

  it('is MARKED_REVIEW when it is marked with nothing chosen', () => {
    const marked = change({ state: ANSWER_STATE.MARKED_REVIEW, selectedOptionId: null });

    assert.equal(stateOf(marked), ANSWER_STATE.MARKED_REVIEW);
  });

  /** The failure this prevents: Clear Response leaving a question counted as answered. */
  it('returns a cleared response to NOT_ANSWERED, never to NOT_VISITED', () => {
    const cleared = change({ state: ANSWER_STATE.ANSWERED, selectedOptionId: null });

    assert.equal(stateOf(cleared), ANSWER_STATE.NOT_ANSWERED);
  });

  it('keeps a question nobody has opened at NOT_VISITED', () => {
    const unseen = change({ state: ANSWER_STATE.NOT_VISITED, selectedOptionId: null });

    assert.equal(stateOf(unseen), ANSWER_STATE.NOT_VISITED);
  });

  it('reads whitespace as no answer at all', () => {
    const blank = change({
      state: ANSWER_STATE.ANSWERED,
      selectedOptionId: null,
      typedAnswer: '  ',
    });

    assert.equal(stateOf(blank), ANSWER_STATE.NOT_ANSWERED);
  });

  /** A client claiming ANSWERED with nothing chosen must not be able to make it so. */
  it('does not take the screen at its word', () => {
    const lying = change({ state: ANSWER_STATE.ANSWERED_MARKED, selectedOptionId: null });

    assert.equal(stateOf(lying), ANSWER_STATE.MARKED_REVIEW);
  });
});

describe('applyBatch', () => {
  it('writes an answer the held state did not have', () => {
    const next = applyBatch(held(), { revision: 1, answers: [change()] });

    assert.equal(next.answers.q1?.state, ANSWER_STATE.ANSWERED);
    assert.equal(next.answers.q1?.selectedOptionId, 'opt_a');
    assert.equal(next.revision, 1);
  });

  /** The failure this prevents: a cleared answer scored later from an option nobody chose. */
  it('drops the option when the answer is cleared', () => {
    const first = applyBatch(held(), { revision: 1, answers: [change()] });
    const cleared = applyBatch(first, {
      revision: 2,
      answers: [change({ selectedOptionId: null, timeSpentSec: 20 })],
    });

    assert.equal(cleared.answers.q1?.selectedOptionId, null);
    assert.equal(cleared.answers.q1?.state, ANSWER_STATE.NOT_ANSWERED);
  });

  /** A first touch happens once: a later save carrying a later stamp must not move it. */
  it('keeps the earliest first action, whichever save carries it', () => {
    const first = applyBatch(held(), {
      revision: 1,
      answers: [change({ firstActionAt: '2026-09-01T05:00:20.000Z' })],
    });
    const later = applyBatch(first, {
      revision: 2,
      answers: [change({ firstActionAt: '2026-09-01T05:09:00.000Z' })],
    });

    assert.equal(later.answers.q1?.firstActionAt, '2026-09-01T05:00:20.000Z');
  });

  /** A reloaded screen re-stamps from when IT opened the question; the older stamp still wins. */
  it('takes an earlier first action from a later save', () => {
    const first = applyBatch(held(), {
      revision: 1,
      answers: [change({ firstActionAt: '2026-09-01T05:09:00.000Z' })],
    });
    const earlier = applyBatch(first, {
      revision: 2,
      answers: [change({ firstActionAt: '2026-09-01T05:00:20.000Z' })],
    });

    assert.equal(earlier.answers.q1?.firstActionAt, '2026-09-01T05:00:20.000Z');
  });

  /** Time is a TOTAL: a screen that reloads and counts from zero must not shorten the record. */
  it('never lets time spent go backwards', () => {
    const first = applyBatch(held(), { revision: 1, answers: [change({ timeSpentSec: 90 })] });
    const second = applyBatch(first, { revision: 2, answers: [change({ timeSpentSec: 5 })] });

    assert.equal(second.answers.q1?.timeSpentSec, 90);
  });

  it('leaves questions the batch does not mention alone', () => {
    const first = applyBatch(held(), { revision: 1, answers: [change()] });
    const second = applyBatch(first, {
      revision: 2,
      answers: [change({ questionId: 'q2', selectedOptionId: 'opt_b' })],
    });

    assert.equal(second.answers.q1?.selectedOptionId, 'opt_a');
    assert.equal(second.answers.q2?.selectedOptionId, 'opt_b');
  });

  /** The failure this prevents: a retried save undoing the answer that overtook it. */
  it('drops a batch that has been overtaken', () => {
    const first = applyBatch(held(), {
      revision: 4,
      answers: [change({ selectedOptionId: 'opt_a' })],
    });
    const late = applyBatch(first, {
      revision: 3,
      answers: [change({ selectedOptionId: 'opt_z' })],
    });

    assert.equal(late.answers.q1?.selectedOptionId, 'opt_a');
    assert.equal(late.revision, 4);
    assert.equal(isStale(first, { revision: 3, answers: [] }), true);
    assert.equal(isStale(first, { revision: 5, answers: [] }), false);
  });

  it('merges section clocks without dropping the ones it does not carry', () => {
    const first = applyBatch(held(), {
      revision: 1,
      answers: [],
      sections: { sec_1: { remainingSec: 100, closed: false } },
    });
    const second = applyBatch(first, {
      revision: 2,
      answers: [],
      sections: { sec_2: { remainingSec: 500, closed: false } },
    });

    assert.equal(second.sections.sec_1?.remainingSec, 100);
    assert.equal(second.sections.sec_2?.remainingSec, 500);
  });
});

describe('isInTime', () => {
  const at = (iso: string) => new Date(iso);

  it('takes a save inside the sitting', () => {
    assert.equal(isInTime(held(), at('2026-09-01T05:29:59.000Z')), true);
  });

  /** A request in flight as the clock expires is not cheating. */
  it('takes one that lands inside the grace', () => {
    assert.equal(isInTime(held(), at('2026-09-01T05:30:20.000Z')), true);
    assert.equal(SAVE_GRACE_SEC, 30);
  });

  it('refuses one past the grace', () => {
    assert.equal(isInTime(held(), at('2026-09-01T05:30:31.000Z')), false);
  });
});

describe('a paper put down, and one abandoned', () => {
  const at = (iso: string) => new Date(iso);
  /** Left the paper at 05:10 with twenty minutes still on it. */
  const putDown = held({ lastSeenAt: '2026-09-01T05:10:00.000Z' });

  it('gives back every second the paper was off screen, bar the grace', () => {
    // Back a day later: the twenty minutes left are twenty minutes, less the minute of grace.
    const resumed = creditedEndsAt(putDown, at('2026-09-02T05:10:00.000Z'));
    assert.equal(resumed.toISOString(), '2026-09-02T05:29:00.000Z');
  });

  it('gives back nothing to a sitting still being written to', () => {
    assert.equal(
      creditedEndsAt(putDown, at('2026-09-01T05:10:00.000Z')).toISOString(),
      ENDS_AT,
      'no gap, no credit',
    );
  });

  /** The failure this prevents: reloading on a loop, banking the autosave interval every time. */
  it('gives back nothing for a gap short enough to have been sat through', () => {
    assert.equal(
      creditedEndsAt(putDown, at('2026-09-01T05:10:59.000Z')).toISOString(),
      ENDS_AT,
      'a minute of quiet is reading, not leaving',
    );
    assert.equal(PRESENT_GRACE_SEC, 60);
  });

  it('takes that grace off the whole gap, so the cliff cannot be farmed', () => {
    // Two minutes away credits one: the grace is subtracted, never a threshold to clear.
    assert.equal(
      creditedEndsAt(putDown, at('2026-09-01T05:12:00.000Z')).toISOString(),
      '2026-09-01T05:31:00.000Z',
    );
  });

  /** The failure this prevents: a sitting nobody came back to, resumable for ever. */
  it('is abandoned once nobody has come back inside the limit', () => {
    assert.equal(isAbandoned(putDown, at('2026-09-03T05:09:00.000Z')), false);
    assert.equal(isAbandoned(putDown, at('2026-09-03T05:11:00.000Z')), true);
    assert.equal(PAUSE_LIMIT_SEC, 48 * 60 * 60);
  });

  /** A key written before this shipped has no last save, so the start is the only instant it has. */
  it('counts from the start when nothing has been saved yet', () => {
    assert.equal(awayMs(held(), at('2026-09-01T05:01:00.000Z')), 60_000);
  });
});

describe('the cap on what a sitting can bank across every pause', () => {
  const at = (iso: string) => new Date(iso);

  it('still credits a legitimate pause in full while room remains', () => {
    const midway = held({
      lastSeenAt: '2026-09-01T05:10:00.000Z',
      creditedMs: 10 * 60 * 60 * 1000,
    });
    // Ten hours already banked and an hour more away: comfortably under the 48-hour cap.
    const resumed = creditedEndsAt(midway, at('2026-09-01T06:10:00.000Z'));
    assert.equal(resumed.toISOString(), '2026-09-01T06:29:00.000Z');
  });

  /** The failure this prevents: one long idle after the cap is nearly spent still crediting the whole gap. */
  it('tops out at whatever room is left rather than crediting the whole gap', () => {
    const almostSpent = held({
      lastSeenAt: '2026-09-01T05:10:00.000Z',
      creditedMs: PAUSE_CREDIT_CAP_SEC * 1000 - 60_000,
    });
    // One minute of room left, a whole day away: only the minute of room is given.
    const resumed = creditedEndsAt(almostSpent, at('2026-09-02T05:10:00.000Z'));
    assert.equal(resumed.toISOString(), '2026-09-01T05:31:00.000Z');
    assert.equal(PAUSE_CREDIT_CAP_SEC, PAUSE_LIMIT_SEC);
  });

  /** The failure this prevents: idling twenty minutes and reloading, repeated without bound. */
  it('cannot be out-earned by any number of reload cycles', () => {
    const cycle = (creditedMs: number) =>
      held({ lastSeenAt: '2026-09-01T05:10:00.000Z', creditedMs });
    const reload = at('2026-09-01T05:30:00.000Z'); // twenty minutes away, every cycle

    let creditedMs = 0;
    for (let i = 0; i < 200; i += 1) {
      creditedMs += creditMs(cycle(creditedMs), reload);
    }

    assert.equal(creditedMs, PAUSE_CREDIT_CAP_SEC * 1000);
  });

  /** The failure this prevents: a tab reopened every day holding a spent sitting IN_PROGRESS for weeks. */
  it('reads a sitting out of credit as abandoned, however recently it reloaded', () => {
    const justReloaded = { lastSeenAt: '2026-09-01T05:29:00.000Z' };
    const spent = held({ ...justReloaded, creditedMs: PAUSE_CREDIT_CAP_SEC * 1000 });
    const banking = held({ ...justReloaded, creditedMs: 60_000 });

    assert.equal(isAbandoned(spent, at('2026-09-01T05:30:00.000Z')), true);
    assert.equal(isAbandoned(banking, at('2026-09-01T05:30:00.000Z')), false);
  });
});

describe('a section clock the server stamps', () => {
  const at = (iso: string) => new Date(iso);
  const batch = (sections: Record<string, { remainingSec: number; closed: boolean }>) => ({
    revision: 1,
    answers: [],
    sections,
  });

  /** The failure this prevents: a reload restarting a section at its full allowance. */
  it('stamps an opened section with the instant the SERVER saw it', () => {
    const next = applyBatch(
      held(),
      batch({ sec_1: { remainingSec: 1800, closed: false } }),
      at('2026-09-01T05:05:00.000Z'),
    );
    assert.equal(next.sections.sec_1?.openedAt, '2026-09-01T05:05:00.000Z');
  });

  it('keeps the first stamp, so reporting again does not restart the clock', () => {
    const opened = applyBatch(
      held(),
      batch({ sec_1: { remainingSec: 1800, closed: false } }),
      at('2026-09-01T05:05:00.000Z'),
    );
    const again = applyBatch(
      { ...opened, revision: 1 },
      batch({ sec_1: { remainingSec: 900, closed: false } }),
      at('2026-09-01T05:20:00.000Z'),
    );
    assert.equal(again.sections.sec_1?.openedAt, '2026-09-01T05:05:00.000Z');
  });

  it('gives back the away time to a section still open', () => {
    const put = held({
      lastSeenAt: '2026-09-01T05:10:00.000Z',
      sections: {
        sec_1: { remainingSec: 1200, closed: false, openedAt: '2026-09-01T05:00:00.000Z' },
      },
    });
    const credited = creditedSections(put, at('2026-09-02T05:10:00.000Z'));
    assert.equal(credited.sec_1?.openedAt, '2026-09-02T04:59:00.000Z');
  });

  it('leaves a closed section where it stands', () => {
    const put = held({
      lastSeenAt: '2026-09-01T05:10:00.000Z',
      sections: { sec_1: { remainingSec: 0, closed: true, openedAt: '2026-09-01T05:00:00.000Z' } },
    });
    assert.equal(
      creditedSections(put, at('2026-09-02T05:10:00.000Z')).sec_1?.openedAt,
      '2026-09-01T05:00:00.000Z',
    );
  });
});

describe('pending — what a flush has left to write', () => {
  const saved = (questionIds: readonly string[], revision: number) => ({
    revision,
    answers: questionIds.map((questionId) => change({ questionId })),
  });

  it('records every question a save touched', () => {
    const next = applyBatch(held(), saved(['q1', 'q2'], 1));

    assert.deepEqual(next.pending, ['q1', 'q2']);
  });

  /** The point of the list: a later pass rewrites the two that moved, not the eighty that did not. */
  it('adds to what an earlier save left, and never lists one twice', () => {
    const first = applyBatch(held(), saved(['q1', 'q2'], 1));
    const second = applyBatch(first, saved(['q2', 'q3'], 2));

    assert.deepEqual(second.pending, ['q1', 'q2', 'q3']);
  });

  it('leaves the list alone for a batch a newer save already carried', () => {
    const first = applyBatch(held(), saved(['q1'], 5));

    assert.deepEqual(applyBatch(first, saved(['q9'], 5)).pending, ['q1']);
  });
});

describe('AttemptStateService.save — the ack tells the truth', () => {
  const IN_TIME = new Date('2026-09-01T05:10:00.000Z');
  const service = (redis: FakeRedis) =>
    new AttemptStateService({} as PrismaService, redis.asService(), {} as PaperSheetService);
  const batch = (revision: number) => ({
    revision,
    answers: [change()],
    sections: {},
  });

  /** The failure this prevents: a batch dropped under an EQUAL revision echoing back as "Saved". */
  it('answers applied: false when the batch was dropped as stale', async () => {
    const redis = new FakeRedis();
    await redis.setJson(redisKeys.attemptState('att_1'), packHeld(held({ revision: 7 })), 60);

    const ack = await service(redis).save('stu_1', 'att_1', batch(7), IN_TIME);

    assert.equal(ack.applied, false);
    assert.equal(ack.revision, 7, 'the echo alone could not have said it was dropped');
    const after = await redis.getJson<HeldState>(redisKeys.attemptState('att_1'));
    assert.deepEqual(after?.answers, {}, 'the stale batch really was dropped');
  });

  it('answers applied: true when the batch landed', async () => {
    const redis = new FakeRedis();
    await redis.setJson(redisKeys.attemptState('att_1'), packHeld(held({ revision: 7 })), 60);

    const ack = await service(redis).save('stu_1', 'att_1', batch(8), IN_TIME);

    assert.equal(ack.applied, true);
    assert.equal(ack.revision, 8);
  });
});

describe('AttemptStateService.clearPending', () => {
  const service = (redis: FakeRedis) =>
    new AttemptStateService({} as PrismaService, redis.asService(), {} as PaperSheetService);

  const answer: LiveAnswer = {
    state: ANSWER_STATE.ANSWERED,
    selectedOptionId: 'o1',
    typedAnswer: null,
    timeSpentSec: 10,
    answeredAt: '2026-09-01T05:01:00.000Z',
    firstActionAt: '2026-09-01T05:00:30.000Z',
  };

  /** The failure this prevents: a save landing mid-pass cleared unwritten, so its answer never lands. */
  it('clears only what the pass wrote, keeping a mark made while it ran', async () => {
    const redis = new FakeRedis();
    await redis.setJson(
      redisKeys.attemptState('att_1'),
      packHeld(held({ pending: ['q1', 'q2'], answers: { q1: answer } })),
      60,
    );

    await service(redis).clearPending('att_1', { q1: answer });

    const after = await redis.getJson<HeldState>(redisKeys.attemptState('att_1'));
    assert.deepEqual(after?.pending, ['q2']);
  });

  it('writes nothing when the pass wrote nothing', async () => {
    const redis = new FakeRedis();
    await redis.setJson(redisKeys.attemptState('att_1'), packHeld(held({ pending: ['q1'] })), 60);

    await service(redis).clearPending('att_1', {});

    const after = await redis.getJson<HeldState>(redisKeys.attemptState('att_1'));
    assert.deepEqual(after?.pending, ['q1']);
  });

  it('drops the dirty mark once everything the pass wrote has settled', async () => {
    const redis = new FakeRedis();
    await redis.setJson(
      redisKeys.attemptState('att_1'),
      packHeld(held({ pending: ['q1'], answers: { q1: answer } })),
      60,
    );
    await redis.client.sadd(redisKeys.attemptsDirty, 'att_1');

    const settled = await service(redis).clearPending('att_1', { q1: answer });

    assert.equal(settled, true);
    assert.deepEqual(await redis.client.smembers(redisKeys.attemptsDirty), []);
  });

  /** The bug this prevents: a flush that just settled wiping the fresh mark a racing save just set. */
  it('keeps the mark a save sets between the settling write and the unmark check', async () => {
    const redis = new FakeRedis();
    await redis.setJson(
      redisKeys.attemptState('att_1'),
      packHeld(held({ pending: ['q1'], answers: { q1: answer } })),
      60,
    );
    await redis.client.sadd(redisKeys.attemptsDirty, 'att_1');
    const attemptService = service(redis);

    const realGetRaw = redis.getRaw.bind(redis);
    let reads = 0;
    redis.getRaw = async (key: string) => {
      reads += 1;
      // The second read is clearPending's own post-write check; race a save in right before it.
      if (reads === 2) {
        await attemptService.save(
          'stu_1',
          'att_1',
          { revision: 1, answers: [change()] },
          new Date('2026-09-01T05:10:00.000Z'),
        );
      }
      return realGetRaw(key);
    };

    const settled = await attemptService.clearPending('att_1', { q1: answer });

    assert.equal(settled, true);
    assert.deepEqual(await redis.client.smembers(redisKeys.attemptsDirty), ['att_1']);
  });
});

describe('pendingAfter', () => {
  const answer = (selectedOptionId: string): LiveAnswer => ({
    state: ANSWER_STATE.ANSWERED,
    selectedOptionId,
    typedAnswer: null,
    timeSpentSec: 10,
    answeredAt: '2026-09-01T05:01:00.000Z',
    firstActionAt: '2026-09-01T05:00:30.000Z',
  });
  const held = (answers: Record<string, LiveAnswer>, pending: string[]): HeldState => ({
    attemptId: 'att_1',
    studentId: 'stu_1',
    testId: 'test_1',
    startedAt: '2026-09-01T05:00:00.000Z',
    endsAt: '2026-09-01T06:00:00.000Z',
    revision: 3,
    answers,
    pending,
    sections: {},
  });

  it('clears what the flush wrote and nothing a save changed after it read', () => {
    const written = { q1: answer('o1'), q2: answer('o1') };
    const now = held({ q1: answer('o1'), q2: answer('o2'), q3: answer('o3') }, ['q1', 'q2', 'q3']);

    assert.deepEqual(pendingAfter(now, written), ['q2', 'q3']);
  });

  it('leaves nothing pending for a key with no list, whose pass wrote the whole paper', () => {
    const now = { ...held({ q1: answer('o1') }, []), pending: undefined };

    assert.deepEqual(pendingAfter(now, { q1: answer('o1') }), []);
  });
});

describe('the live key — written by position, read back by name', () => {
  const answered: LiveAnswer = {
    state: ANSWER_STATE.ANSWERED_MARKED,
    selectedOptionId: 'opt_a',
    typedAnswer: null,
    timeSpentSec: 35,
    answeredAt: '2026-09-01T05:00:40.000Z',
    firstActionAt: '2026-09-01T05:00:12.000Z',
  };
  const typed: LiveAnswer = {
    state: ANSWER_STATE.ANSWERED,
    selectedOptionId: null,
    typedAnswer: '42.5',
    timeSpentSec: 12,
    answeredAt: '2026-09-01T05:01:00.000Z',
    firstActionAt: null,
  };

  /** The failure this prevents: a sitting coming back from Redis with somebody else's answers. */
  it('reads back every answer it wrote', () => {
    const state = held({ answers: { q1: answered, q2: typed }, pending: ['q2'], tab: 'tab_a' });

    assert.deepEqual(heldIn(packHeld(state)), state);
  });

  it('writes an answer as the sheet does, with the option still an id', () => {
    const stored = packHeld(held({ answers: { q1: answered } }));

    assert.deepEqual(stored.answers.q1, [4, 'opt_a', 35, 12, 40]);
  });

  /** A key from before this shipped holds objects where slots go: rebuilt from Postgres, not half-read. */
  it('reads a key in the shape before this one as no key at all', () => {
    const before = { ...held(), answers: { q1: answered } };

    assert.equal(heldIn(before), null);
  });

  it('reads a value that is not a held sitting as no key at all', () => {
    assert.equal(heldIn(null), null);
    assert.equal(heldIn('gone'), null);
    assert.equal(heldIn({ attemptId: 'att_1' }), null);
  });
});
