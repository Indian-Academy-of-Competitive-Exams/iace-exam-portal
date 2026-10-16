import { Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { fireEvent, screen } from 'expo-router/testing-library';
import { ErrorCodes, ME_ATTEMPT_ROUTES } from '@iace/contracts';
import { HELD_ELSEWHERE_SAYS } from '@iace/app-kit';
import ExamScreen from '../app/exam/[testId]';
import { EXAM_RESUME_PARAM } from '../src/lib/constants';
import { fetchMock, refused, sentTo, serve } from './support/network';
import { renderRoutes } from './support/render';

const TEST_ID = 'test-1';
const ATTEMPT_ID = 'attempt-1';
const START = ME_ATTEMPT_ROUTES.start(TEST_ID);
const SUBMITTED_FOR = 'Submitted: ';

/** Stands in for the submitted screen, naming the sitting it was sent for. */
function Submitted() {
  const { attemptId } = useLocalSearchParams<{ attemptId: string }>();
  return <Text>{`${SUBMITTED_FOR}${attemptId}`}</Text>;
}

async function openExam(start: () => Response, query = '') {
  serve({
    // A brief that did not load does not keep the student from an ordinary paper.
    [ME_ATTEMPT_ROUTES.brief(TEST_ID)]: () => refused(ErrorCodes.NOT_FOUND, 'No brief'),
    [START]: start,
  });
  return renderRoutes(
    { 'exam/[testId]': ExamScreen, 'attempts/[attemptId]/submitted': Submitted },
    `/exam/${TEST_ID}${query}`,
  );
}

beforeEach(() => fetchMock.mockReset());

test('a test that will not start says so, and Retry asks the server again', async () => {
  await openExam(() => refused(ErrorCodes.FORBIDDEN, 'Not open'));

  expect(await screen.findByText('This test could not be started')).toBeOnTheScreen();
  expect(screen.getByText('Go to your tests')).toBeOnTheScreen();

  await fireEvent.press(screen.getByText('Retry'));
  expect(sentTo(START)).toHaveLength(2);
});

test('a test open on another device says so instead of starting a second sitting', async () => {
  await openExam(() => refused(ErrorCodes.SITTING_HELD_ELSEWHERE, 'Elsewhere'));

  expect(await screen.findByText(HELD_ELSEWHERE_SAYS.title)).toBeOnTheScreen();
  expect(screen.getByText('Try again')).toBeOnTheScreen();
});

test('resuming a sitting already handed in goes to its submitted screen, not a fresh paper', async () => {
  await openExam(
    () => refused(ErrorCodes.SITTING_ENDED, 'Ended'),
    `?${EXAM_RESUME_PARAM}=${ATTEMPT_ID}`,
  );

  expect(await screen.findByText(`${SUBMITTED_FOR}${ATTEMPT_ID}`)).toBeOnTheScreen();
  expect(sentTo(START)).toHaveLength(1);
});
