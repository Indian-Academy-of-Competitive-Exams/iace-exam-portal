import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import { AUTH_ROUTES, ActorTypes } from '@iace/contracts';
import LoginScreen from '../app/login';
import { tokenStore } from '../src/lib/api';
import { fetchMock, ok, refused, sentTo, serve } from './support/network';
import { renderRoutes } from './support/render';

const MOBILE = '9876543210';
const CODE = '123456';
const ACCESS_TOKEN = 'access-token';
const WRONG_CODE_SAYS = 'That code is not right';

const codeSent = () =>
  ok({ sent: true, expiresInSec: 300, resendAfterSec: 30, codeLength: CODE.length });

const session = () =>
  ok({
    tokens: { accessToken: ACCESS_TOKEN, refreshToken: 'refresh-token', expiresInSec: 900 },
    identity: {
      actor: ActorTypes.STUDENT,
      id: 'student-1',
      mobile: MOBILE,
      fullName: null,
      preTestReady: true,
      profileCompleted: true,
      isTestBlocked: false,
    },
  });

async function enterCode(verify: () => Response) {
  serve({ [AUTH_ROUTES.studentOtpRequest]: codeSent, [AUTH_ROUTES.studentOtpVerify]: verify });
  await renderRoutes({ login: LoginScreen }, '/login');

  await fireEvent.changeText(screen.getByPlaceholderText('98765 43210'), MOBILE);
  await fireEvent.press(screen.getByText('Send code'));
  expect(await screen.findByText(`Sent to +91 ${MOBILE}`)).toBeOnTheScreen();

  await fireEvent.changeText(screen.getByLabelText('One-time code'), CODE);
  await fireEvent.press(screen.getByText('Sign in'));
}

beforeEach(() => {
  fetchMock.mockReset();
  tokenStore.clear();
});

test('a student asks for a code to their mobile, types it, and is signed in', async () => {
  await enterCode(session);

  await waitFor(() => expect(tokenStore.get()?.accessToken).toBe(ACCESS_TOKEN));
  expect(sentTo(AUTH_ROUTES.studentOtpRequest)).toEqual([{ mobile: MOBILE }]);
  expect(sentTo(AUTH_ROUTES.studentOtpVerify)).toEqual([{ mobile: MOBILE, code: CODE }]);
});

test('a refused code is shown under the field and does not sign the student in', async () => {
  await enterCode(() => refused('OTP_INVALID', WRONG_CODE_SAYS, { code: [WRONG_CODE_SAYS] }));

  expect(await screen.findByText(WRONG_CODE_SAYS)).toBeOnTheScreen();
  expect(screen.getByText('Enter the code')).toBeOnTheScreen();
  expect(tokenStore.get()).toBeNull();
});
