/** The student sign-in both clients walk: a mobile, then the code sent to it. The first time is the signup. */
import { useCallback, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { OTP_CHANNELS, type OtpChannel, type OtpRequestResponse } from '@iace/contracts';
import { type AppApiClient } from './api-client';
import { useCountdown } from './exam/use-countdown';

/** The fields each form owns; the server keys `fieldErrors` by the same names. */
export const LOGIN_FIELDS = {
  MOBILE: ['mobile'],
  CODE: ['code'],
} as const;

/** No "do you have an account?" fork: the same two steps serve a first visit and every one after. */
export type LoginStep =
  { kind: 'mobile' } | { kind: 'code'; mobile: string; challenge: OtpRequestResponse };

const CHANNEL_NAMES: Record<OtpChannel, string> = {
  [OTP_CHANNELS.SMS]: 'SMS',
  [OTP_CHANNELS.WHATSAPP]: 'WhatsApp',
};

/** Where the code went, so a student knows which app to look in. */
export function sentSays(challenge: Pick<OtpRequestResponse, 'channel'>, mobile: string): string {
  const by = challenge.channel ? ` by ${CHANNEL_NAMES[challenge.channel]}` : '';
  return `Sent${by} to +91 ${mobile}`;
}

/** The resend button's words: which way the next code goes, and how long until it may be asked for. */
export function resendSays(waitSec: number, next: OtpChannel | undefined): string {
  const way = next ? `by ${CHANNEL_NAMES[next]}` : 'again';
  return waitSec > 0 ? `Send ${way} in ${waitSec}s` : `Send ${way}`;
}

const NOTHING_ON_EXPIRY = () => undefined;

/** Asking again: after the wait the server enforces anyway, and by the other channel where there is one. */
export function useResendCode(
  api: AppApiClient,
  mobile: string,
  challenge: OtpRequestResponse,
  onResent: (fresh: OtpRequestResponse) => void,
) {
  const [sentAt, setSentAt] = useState(() => Date.now());
  const { resendAfterSec, channel, otherChannel } = challenge;
  const secondsLeftNow = useCallback(
    () => Math.max(0, Math.ceil(resendAfterSec - (Date.now() - sentAt) / 1000)),
    [resendAfterSec, sentAt],
  );
  const waitSec = useCountdown(secondsLeftNow, NOTHING_ON_EXPIRY);

  const again = useMutation({
    // Never both at once: the next code goes the other way, or the same way where there is only one.
    mutationFn: () => api.auth.requestStudentOtp({ mobile, channel: otherChannel ?? channel }),
    onSuccess: (fresh) => {
      setSentAt(Date.now());
      onResent(fresh);
    },
  });

  return {
    label: resendSays(waitSec, otherChannel),
    canResend: waitSec === 0 && !again.isPending,
    isPending: again.isPending,
    resend: () => again.mutate(),
  };
}
