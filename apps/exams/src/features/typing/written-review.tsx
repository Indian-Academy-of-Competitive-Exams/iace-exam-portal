/** A written answer in the review: what they wrote, what each check made of it, and who did the marking. */
import {
  WRITING_WEIGHTS,
  keyPointsIn,
  scoreWriting,
  type AnswerKey,
  type WritingCheck,
} from '@iace/contracts';
import { Alert, Badge, StatRow } from '@iace/ui';
import { ATTEMPT_NOTICE, WRITTEN_NOTICE } from './written-notice';

const CHECK_LABELS: Readonly<Record<WritingCheck, string>> = {
  keyPoints: 'Key points made',
  length: 'Length',
  format: 'Format',
  mechanics: 'Sentences',
};
const PERCENT = 100;

export function WrittenReview({
  answer,
  answerKey,
}: Readonly<{ answer: string | null; answerKey: AnswerKey | null | undefined }>) {
  const result = scoreWriting(answer ?? '', answerKey?.rubric, keyPointsIn(answerKey?.answers));

  return (
    <div className="flex flex-col gap-4">
      <Alert variant="info">{result.attemptOnly ? ATTEMPT_NOTICE : WRITTEN_NOTICE}</Alert>

      <section aria-label="Your answer" className="flex flex-col gap-2">
        <StatRow label="Your answer" value={`${result.words.toLocaleString('en-IN')} words`} />
        <p className="whitespace-pre-wrap rounded-md border border-border p-3 text-sm leading-relaxed">
          {answer?.trim() ? answer : '—'}
        </p>
      </section>

      {result.attemptOnly ? null : (
        <>
          <div className="flex flex-col gap-2">
            {(Object.keys(WRITING_WEIGHTS) as WritingCheck[]).map((check) => (
              <StatRow
                key={check}
                label={`${CHECK_LABELS[check]} (${WRITING_WEIGHTS[check] * PERCENT}% of the marks)`}
                value={`${Math.round(result.shares[check] * PERCENT)}%`}
              />
            ))}
          </div>
          <ul className="flex flex-wrap gap-2">
            {result.keyPoints.map((point) => (
              <li key={point.text}>
                <Badge variant={point.found ? 'success' : 'neutral'}>
                  <span className="sr-only">{point.found ? 'Made: ' : 'Missed: '}</span>
                  {point.text}
                </Badge>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
