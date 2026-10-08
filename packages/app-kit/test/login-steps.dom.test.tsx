import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppException, ErrorCodes, OTP_CHANNELS, type OtpRequestResponse } from '@iace/contracts';
import { useResendCode } from '../src/login-steps';
import type { AppApiClient } from '../src';

const MOBILE = '9876543210';

const challenge = (over: Partial<OtpRequestResponse> = {}): OtpRequestResponse => ({
  sent: true,
  expiresInSec: 300,
  resendAfterSec: 45,
  codeLength: 6,
  channel: OTP_CHANNELS.WHATSAPP,
  otherChannel: OTP_CHANNELS.SMS,
  ...over,
});

const bySms = (): Promise<OtpRequestResponse> =>
  Promise.resolve(challenge({ channel: OTP_CHANNELS.SMS, otherChannel: OTP_CHANNELS.WHATSAPP }));

function mounted(
  asked: unknown[],
  sent: OtpRequestResponse,
  t: { after: (fn: () => void) => void },
  answer = bySms,
) {
  mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const api = {
    auth: {
      requestStudentOtp: (input: unknown) => {
        asked.push(input);
        return answer();
      },
    },
  } as unknown as AppApiClient;
  // A real client never lets node:test exit unless nothing is kept and nothing is retried.
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  const resent: OtpRequestResponse[] = [];
  const view = renderHook(() => useResendCode(api, MOBILE, sent, (fresh) => resent.push(fresh)), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  t.after(() => {
    view.unmount();
    client.clear();
    mock.timers.reset();
  });
  return { ...view, resent };
}

const pass = (ms: number) =>
  act(async () => {
    mock.timers.tick(ms);
    await Promise.resolve();
  });

/** The failure this prevents: a student tapping for code after code, each one a paid message the server would refuse anyway. */
test('holds the next code back until the wait is over, counting it down', async (t) => {
  const asked: unknown[] = [];
  const { result } = mounted(asked, challenge(), t);

  assert.equal(result.current.canResend, false);
  assert.equal(result.current.label, 'Send by SMS in 45s');

  await pass(44_000);
  assert.equal(result.current.canResend, false);

  await pass(1_000);
  assert.equal(result.current.canResend, true);
  assert.equal(result.current.label, 'Send by SMS');
  assert.deepEqual(asked, []);
});

/** One at a time: the code that did not arrive by WhatsApp is asked for by SMS, never by both. */
test('asks for the next code on the other channel, once, and hands it up', async (t) => {
  const asked: unknown[] = [];
  const { result, resent } = mounted(asked, challenge(), t);
  await pass(45_000);

  await act(async () => {
    result.current.resend();
    await Promise.resolve();
    await Promise.resolve();
  });

  assert.deepEqual(asked, [{ mobile: MOBILE, channel: OTP_CHANNELS.SMS }]);
  assert.equal(resent[0]?.channel, OTP_CHANNELS.SMS);
});

test('asks the same way again where only one channel is set up', async (t) => {
  const asked: unknown[] = [];
  const only = challenge({ channel: OTP_CHANNELS.SMS, otherChannel: undefined });
  const { result } = mounted(asked, only, t);
  await pass(45_000);

  await act(async () => {
    result.current.resend();
    await Promise.resolve();
  });

  assert.equal(result.current.label.startsWith('Send again'), true);
  assert.deepEqual(asked, [{ mobile: MOBILE, channel: OTP_CHANNELS.SMS }]);
});

/** The failure this prevents: a resend that could not be sent leaving the button live, to be refused on the next tap. */
test('counts the wait the server names when the next code could not be sent', async (t) => {
  const unsent = () =>
    Promise.reject(
      new AppException(ErrorCodes.SERVICE_UNAVAILABLE, undefined, {
        details: { retryAfterSec: 45 },
      }),
    );
  const { result } = mounted([], challenge(), t, unsent);
  await pass(45_000);

  await act(async () => {
    result.current.resend();
    await Promise.resolve();
    await Promise.resolve();
  });
  await pass(1_000);

  assert.equal(result.current.canResend, false);
  assert.equal(result.current.label, 'Send by SMS in 44s');
});
