import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type QuestionOnOtherTest } from '@iace/contracts';
import { Alert, SkeletonParagraph } from '@iace/ui';
import { QUERY_KEYS } from '../lib/constants';

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

/** Silent when nothing else holds the question, which is what makes it worth reading. */
function CrossTestWarning({
  loading,
  tests,
}: Readonly<{ loading: boolean; tests: readonly QuestionOnOtherTest[] }>) {
  const [open, sharedOnly] = useMemo(
    () => [tests.filter((test) => test.isOpen), tests.filter((test) => !test.isOpen)],
    [tests],
  );

  if (loading) return <SkeletonParagraph lines={2} />;
  if (tests.length === 0) return null;

  return (
    <>
      {open.length > 0 ? <Alert variant="warning">{openedMessage(open)}</Alert> : null}

      {sharedOnly.length > 0 ? <Alert variant="info">{sharedMessage(sharedOnly)}</Alert> : null}
    </>
  );
}

/** Asked before the edit, not reported after it: which other tests a fix here reaches. */
export function OtherTestsNotice({
  questionId,
  read,
}: Readonly<{ questionId: string; read: () => Promise<QuestionOnOtherTest[]> }>) {
  const elsewhere = useQuery({
    queryKey: [...QUERY_KEYS.PROOFREADING, 'other-tests', questionId],
    queryFn: read,
  });
  return (
    <div className="flex flex-col gap-2 px-4 pt-4 empty:hidden">
      <CrossTestWarning loading={elsewhere.isLoading} tests={elsewhere.data ?? []} />
    </div>
  );
}
