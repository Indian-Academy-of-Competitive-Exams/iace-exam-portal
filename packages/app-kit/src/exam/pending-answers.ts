/**
 * Everything the server has not acknowledged, and the copy of it that outlives a reload.
 * No React: a plain object, so the hook above it is left with state, timers and promises.
 */
import {
  answerChangeSchema,
  QUESTION_TIME_MAX_SEC,
  SAVE_BATCH_MAX,
  type AnswerChange,
  type SectionProgress,
} from '@iace/contracts';
import { type KeyValueStorage } from '../token-store';

/** What one save carries: answers capped where the contract caps them, and every section touched since. */
export interface UnsentBatch {
  answers: AnswerChange[];
  sections: Record<string, SectionProgress>;
}

export interface PendingAnswers {
  /** Every unsent change, newest copy per question — what a reloaded screen draws. */
  changes: () => AnswerChange[];
  /** Unsent answers only; a backlog past `SAVE_BATCH_MAX` needs more than one save. */
  size: () => number;
  /** Whether anything at all, answer or section, is still to go up. */
  anyUnsent: () => boolean;
  put: (change: AnswerChange) => void;
  putSection: (sectionId: string, progress: SectionProgress) => void;
  batch: () => UnsentBatch;
  /** Takes out only the copies this batch carried; one rewritten since stays for the next save. */
  acknowledge: (batch: UnsentBatch) => void;
  /** The paper is in: the device's copy has nothing left to keep. */
  clear: () => void;
  /** Off screen, the stored copy belongs to whichever screen mounts next: a late ack must not clear it. */
  detach: () => void;
  attach: () => void;
}

export function createPendingAnswers(storage: KeyValueStorage, key: string): PendingAnswers {
  const answers = new Map<string, AnswerChange>(
    storedIn(storage, key).map((change) => [change.questionId, change]),
  );
  const sections = new Map<string, SectionProgress>();
  let mirrored = true;

  const keep = () => {
    if (!mirrored) return;
    try {
      if (answers.size === 0) storage.removeItem(key);
      else storage.setItem(key, JSON.stringify([...answers.values()]));
    } catch {
      // A full or refused store only costs the copy that outlives a reload; saving goes on without it.
    }
  };

  return {
    changes: () => [...answers.values()],
    size: () => answers.size,
    anyUnsent: () => answers.size > 0 || sections.size > 0,
    put: (change) => {
      answers.set(change.questionId, change);
      keep();
    },
    putSection: (sectionId, progress) => {
      sections.set(sectionId, progress);
    },
    batch: () => ({
      answers: [...answers.values()].slice(0, SAVE_BATCH_MAX),
      sections: Object.fromEntries(sections),
    }),
    acknowledge: (batch) => {
      for (const change of batch.answers) {
        if (answers.get(change.questionId) === change) answers.delete(change.questionId);
      }
      for (const [sectionId, progress] of Object.entries(batch.sections)) {
        if (sections.get(sectionId) === progress) sections.delete(sectionId);
      }
      keep();
    },
    clear: () => {
      answers.clear();
      sections.clear();
      keep();
    },
    detach: () => {
      mirrored = false;
    },
    attach: () => {
      mirrored = true;
    },
  };
}

/** Undelivered answers outlive a reload here. Read as a save would read them: any other shape is nothing queued. */
function storedIn(storage: KeyValueStorage, key: string): AnswerChange[] {
  try {
    const held: unknown = JSON.parse(storage.getItem(key) ?? '[]');
    if (!Array.isArray(held)) return [];
    return held.flatMap((stored: unknown) => {
      const change = answerChangeSchema.safeParse(withinTimeCap(stored));
      return change.success ? [change.data] : [];
    });
  } catch {
    return [];
  }
}

/** A copy stored before the cap was kept may be past it: held to it here, or it is dropped with what no save would take. */
function withinTimeCap(stored: unknown): unknown {
  const spent = (stored as Partial<AnswerChange> | null)?.timeSpentSec;
  if (typeof spent !== 'number') return stored;
  return { ...(stored as AnswerChange), timeSpentSec: Math.min(spent, QUESTION_TIME_MAX_SEC) };
}
