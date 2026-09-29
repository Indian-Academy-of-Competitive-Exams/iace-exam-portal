/** Where a sitting's paper comes from, cheapest source first — the same paper however it arrives. */
import {
  servedQuestions,
  type ExamPaper,
  type SharedPaper,
  type StartedAttempt,
} from '@iace/contracts';
import { testPaperQueryKey } from '../student-queries';

/** Only the read is wanted, so a whole query client is more than this needs — and more than a test wants. */
interface HeldPapers {
  getQueryData: <T>(key: readonly unknown[]) => T | undefined;
}

/** Held while they read the instructions, then what the start answered with, then a fetch. */
export async function paperFor(
  started: StartedAttempt,
  papers: HeldPapers,
  fetchPaper: (attemptId: string) => Promise<ExamPaper>,
): Promise<ExamPaper> {
  const held = papers.getQueryData<SharedPaper>(
    testPaperQueryKey(started.testId, started.languages),
  );
  if (!held) return started.paper ?? fetchPaper(started.id);

  return {
    ...held,
    attemptId: started.id,
    endsAt: started.endsAt,
    // The held paper is older than the sitting, so the clock is anchored on the START's answer.
    serverNow: started.serverNow,
    questions: servedQuestions(
      held.questions,
      started.shuffleSeed,
      held.shuffleQuestions,
      held.shuffleOptions,
    ),
  };
}
