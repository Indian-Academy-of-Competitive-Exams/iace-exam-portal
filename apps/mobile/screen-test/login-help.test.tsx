import type * as ReactNative from 'react-native';
import { fireEvent, screen } from 'expo-router/testing-library';
import { LOGIN_HELP_ROUTES, LOGIN_PROBLEMS, SUPPORT_FALLBACK_EMAIL } from '@iace/contracts';
import LoginHelpScreen from '../app/login-help';
import { fetchMock, ok, sentTo, serve } from './support/network';
import { renderRoutes } from './support/render';

const DATE_PICKER = 'date-picker';

// The calendar is a native view jest has no binary for; a host view carries its change handler.
jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = jest.requireActual<typeof ReactNative>('react-native');
  return (props: object) => <View testID="date-picker" {...props} />;
});

const BRANCH = { id: '6f1c2b0e-8a43-4c1d-9d2e-3b5a7c9e1f20', name: 'Dilsukhnagar' };
const EMAIL = 'ravi@example.com';

async function choose(field: string, option: string) {
  await fireEvent.press(screen.getByLabelText(field));
  await fireEvent.press(await screen.findByText(option));
}

beforeEach(() => {
  fetchMock.mockReset();
  serve({
    [LOGIN_HELP_ROUTES.branches]: () => ok([BRANCH]),
    [LOGIN_HELP_ROUTES.submit]: () => ok({ received: true }),
  });
});

test('a signed-out student sends a sign-in query and is told it was received', async () => {
  await renderRoutes({ 'login-help': LoginHelpScreen }, '/login-help');

  await fireEvent.changeText(screen.getByLabelText('Full name'), 'Ravi Kumar');
  await fireEvent.changeText(screen.getByLabelText("Father's name"), 'Suresh Kumar');
  await fireEvent.changeText(screen.getByLabelText('Registered mobile'), '9876543210');
  await fireEvent.press(screen.getByLabelText('Date of birth'));
  await fireEvent(screen.getByTestId(DATE_PICKER), 'valueChange', {}, new Date(2004, 4, 17));
  await choose('Branch', BRANCH.name);
  await fireEvent.changeText(screen.getByLabelText('Email'), EMAIL);
  await choose('Problem', 'The code never arrives');
  await fireEvent.changeText(screen.getByLabelText('Message'), 'No code since Monday');
  await fireEvent.press(screen.getByText('Send'));

  expect(await screen.findByText(`Query received. We will reply to ${EMAIL}.`)).toBeOnTheScreen();
  expect(sentTo(LOGIN_HELP_ROUTES.submit)).toEqual([
    {
      fullName: 'Ravi Kumar',
      fatherName: 'Suresh Kumar',
      registeredMobile: '9876543210',
      dob: '2004-05-17',
      branchId: BRANCH.id,
      contactEmail: EMAIL,
      problem: LOGIN_PROBLEMS.OTP_NOT_ARRIVING,
      body: 'No code since Monday',
    },
  ]);
  expect(screen.getByText(new RegExp(SUPPORT_FALLBACK_EMAIL))).toBeOnTheScreen();
});

test('the fallback address is on screen before anything is sent', async () => {
  await renderRoutes({ 'login-help': LoginHelpScreen }, '/login-help');

  expect(await screen.findByText(new RegExp(SUPPORT_FALLBACK_EMAIL))).toBeOnTheScreen();
  expect(sentTo(LOGIN_HELP_ROUTES.submit)).toEqual([]);
});
