import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type QuestionOnOtherTest } from '@iace/contracts';
import { questionOtherTestsQueryKey } from '../../lib/query-keys';
import { NoticeChip } from './notice-chip';

const TEST_NAMES = new Intl.ListFormat('en-IN', { style: 'long', type: 'conjunction' });

/** "Untitled test" rather than a blank: an unnamed test is still a test somebody has to decide about. */
const nameOf = (test: QuestionOnOtherTest): string => {
  const title = test.testTitle ?? 'Untitled test';
  return test.underReview ? `${title} (still under review)` : title;
};

function openedMessage(open: readonly QuestionOnOtherTest[]): string {
  const names = TEST_NAMES.format(open.map(nameOf));
  const one = open.length === 1;
  const keeps = one ? 'that test keeps' : 'those tests keep';
  return `${names} ${one ? 'has' : 'have'} already opened. A fix here appends a new version, and ${keeps} the version its students were shown. Drop the question from it if that is not what you want.`;
}

function sharedMessage(shared: readonly QuestionOnOtherTest[]): string {
  const names = TEST_NAMES.format(shared.map(nameOf));
  const opened = shared.length === 1 ? 'which has not' : 'none of which have';
  return `This question is also on ${names}, ${opened} opened. A fix here changes it there too.`;
}

/** Silent while it loads and when nothing else holds the question, which is what makes it worth opening. */
export function OtherTestsNotice({
  questionId,
  read,
}: Readonly<{ questionId: string; read: () => Promise<QuestionOnOtherTest[]> }>) {
  const elsewhere = useQuery({
    queryKey: questionOtherTestsQueryKey(questionId),
    queryFn: read,
  });
  const tests = elsewhere.data;
  const [open, sharedOnly] = useMemo(
    () => [
      (tests ?? []).filter((test) => test.isOpen),
      (tests ?? []).filter((test) => !test.isOpen),
    ],
    [tests],
  );

  return (
    <>
      {open.length > 0 ? (
        <NoticeChip tone="warning" label="On tests that have opened">
          {openedMessage(open)}
        </NoticeChip>
      ) : null}
      {sharedOnly.length > 0 ? (
        <NoticeChip tone="info" label="On other tests">
          {sharedMessage(sharedOnly)}
        </NoticeChip>
      ) : null}
    </>
  );
}
