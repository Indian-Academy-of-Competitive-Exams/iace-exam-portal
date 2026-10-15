/** One sitting's saves: never two in the air, a backlog in batches, an idle beat, and the last batch riding the paper. */
import {
  SAVE_BATCH_MAX,
  type AnswerChange,
  type AttemptSaveAck,
  type ExamClock,
  type SectionProgress,
} from '@iace/contracts';
import {
  autosaveDelayMs,
  FINISH_WAIT_MS,
  SAVE_TIMEOUT_MS,
  seedRevision,
  shouldHeartbeat,
} from '../autosave-policy';
import { type PendingAnswers } from './pending-answers';

/** What a save would have carried, handed to the call that ends the sitting instead. */
export interface LastBatch {
  revision: number;
  answers: AnswerChange[];
  sections: Record<string, SectionProgress>;
}

export interface SaveLoopDeps {
  queue: PendingAnswers;
  post: (
    batch: LastBatch,
    init: { signal?: AbortSignal; keepalive?: boolean },
  ) => Promise<AttemptSaveAck>;
  saving: (value: boolean) => void;
  clock: (clock: ExamClock) => void;
  unsaved: (value: boolean) => void;
  refused: (error: unknown) => void;
  /** This screen answers no more, whatever resumes: the sitting is held elsewhere, or over. */
  stoodDown: () => boolean;
}

export interface SaveLoop {
  /** Pushes whatever is pending now. True means every answer held at the call reached the server. */
  flush: () => Promise<boolean>;
  /** The paper going in: the unsent batch rides the call that ends the sitting, and nothing is saved after it. */
  finish: <T>(send: (batch: LastBatch | null) => Promise<T>) => Promise<T>;
  /** Starts the autosave timer; the returned function stops it. */
  start: () => () => void;
  /** Sends everything unsent on keepalive, fire and forget. */
  leave: () => void;
  seed: (heldRevision: number) => void;
  heard: () => void;
  /** The paper could not go in, retries spent: saving starts again, unless this tab was stood down. */
  resume: () => void;
  isStopped: () => boolean;
  isBusy: () => boolean;
  /** Unmounted, a save still in the air is left to land; only its give-up timer goes. */
  dispose: () => void;
}

export function createSaveLoop(deps: SaveLoopDeps): SaveLoop {
  const { queue } = deps;
  let revision = 0;
  let inFlight: Promise<boolean> | null = null;
  let giveUp: ReturnType<typeof setTimeout> | undefined;
  let finishing = false;
  const stopped = () => finishing || deps.stoodDown();
  // When the server last answered this screen: the start that mounted it, then every save since.
  let heardAt = 0;

  const failed = (error: unknown) => {
    deps.unsaved(true);
    deps.refused(error);
  };

  const unsentBatch = (): LastBatch => ({ revision, ...queue.batch() });

  // In the air until it settles, so whatever comes next waits behind it and the last call really is last.
  const inAir = (run: Promise<boolean>): Promise<boolean> => {
    const marked = run.finally(() => {
      if (inFlight === marked) inFlight = null;
    });
    inFlight = marked;
    return marked;
  };

  const save = async (): Promise<boolean> => {
    // Nothing to send is the idle tick saying this device is here: not a save the screen reports.
    const heartbeat = !queue.anyUnsent();
    revision += 1;
    const batch = unsentBatch();
    if (!heartbeat) deps.saving(true);
    const abandon = new AbortController();
    giveUp = setTimeout(() => abandon.abort(), SAVE_TIMEOUT_MS);
    try {
      const saved = await deps.post(batch, { signal: abandon.signal });
      revision = seedRevision(revision, saved.revision);
      heardAt = Date.now();
      // Answering is also a clock check: the deadline it answers with is the one that counts.
      deps.clock({ endsAt: saved.endsAt, serverNow: saved.serverNow, arrivedAt: Date.now() });
      // A batch behind the one the server holds answers 200 too; only `applied` says it landed.
      const applied = saved.applied !== false;
      if (applied) queue.acknowledge(batch);
      if (!heartbeat) deps.unsaved(!applied);
      return applied;
    } catch (error: unknown) {
      if (heartbeat) deps.refused(error);
      else failed(error);
      return false;
    } finally {
      clearTimeout(giveUp);
      deps.saving(false);
    }
  };

  const flush = async (): Promise<boolean> => {
    // Nothing awaited between the last check and the send, so two saves never fly side by side.
    while (inFlight) await inFlight;
    const idle = !queue.anyUnsent();
    if (stopped() || idle) return idle;
    // A backlog past one batch goes up in consecutive saves; one oversized batch would be refused forever.
    let over = queue.size() - SAVE_BATCH_MAX;
    let sent = await inAir(save());
    while (sent && over > 0 && !stopped()) {
      over -= SAVE_BATCH_MAX;
      sent = await inAir(save());
    }
    return sent;
  };

  const finish = async <T>(send: (batch: LastBatch | null) => Promise<T>): Promise<T> => {
    // Behind a save in the air, but not for long: the last batch carries its answers too.
    const giveUpAt = Date.now() + FINISH_WAIT_MS;
    while (inFlight && Date.now() < giveUpAt) {
      await settledWithin(inFlight, giveUpAt - Date.now());
    }
    // Nothing is saved beside the paper going in, nor between its retries, nor after it went.
    finishing = true;
    // Only one batch may ride the paper, so a backlog past it goes up as saves while it still can.
    let over = queue.size() - SAVE_BATCH_MAX;
    while (over > 0 && (await save())) over -= SAVE_BATCH_MAX;
    const idle = !queue.anyUnsent();
    if (!idle) revision += 1;
    const going = (async () => {
      try {
        const done = await send(idle ? null : unsentBatch());
        queue.clear();
        return done;
      } catch (error: unknown) {
        failed(error);
        throw error;
      }
    })();
    void inAir(
      going.then(
        () => true,
        () => false,
      ),
    );
    return going;
  };

  // Rescheduled each time, so the jitter is redrawn rather than fixed at mount.
  const start = () => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const idle = !queue.anyUnsent() && !stopped() && !inFlight;
      // Idle and in touch, the tick still sends: only this device's silence hands the sitting on.
      if (idle && shouldHeartbeat(heardAt, Date.now())) void inAir(save());
      else void flush();
      timer = setTimeout(tick, autosaveDelayMs());
    };
    timer = setTimeout(tick, autosaveDelayMs());
    return () => clearTimeout(timer);
  };

  const leave = () => {
    if (!queue.anyUnsent()) return;
    revision += 1;
    void deps.post(unsentBatch(), { keepalive: true }).catch(() => undefined);
  };

  return {
    flush,
    finish,
    start,
    leave,
    // Never backwards: a flush racing this GET may already have moved the counter on.
    seed: (heldRevision) => {
      revision = seedRevision(revision, heldRevision);
    },
    heard: () => {
      heardAt = Date.now();
    },
    resume: () => {
      finishing = false;
    },
    isStopped: stopped,
    isBusy: () => inFlight !== null,
    dispose: () => clearTimeout(giveUp),
  };
}

/** Settles when `run` does or after `ms`, whichever comes first. */
function settledWithin(run: Promise<unknown>, ms: number): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return Promise.race([run, late]).finally(() => clearTimeout(timer));
}
