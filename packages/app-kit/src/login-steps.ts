/** The student sign-in flow both clients walk: mobile + PIN, and an OTP twice — signup and a forgotten PIN. */
import { type OtpRequestResponse, type PinSetupTicket } from '@iace/contracts';

/** Why the student is going through the OTP flow — it only changes the words. */
export const OTP_INTENTS = { SIGNUP: 'SIGNUP', RESET: 'RESET' } as const;
export type OtpIntent = (typeof OTP_INTENTS)[keyof typeof OTP_INTENTS];

/** The fields each form owns; the server keys `fieldErrors` by the same names. */
export const LOGIN_FIELDS = {
  SIGN_IN: ['mobile', 'pin'],
  MOBILE: ['mobile'],
  CODE: ['code'],
  SET_PIN: ['pin', 'confirmPin'],
} as const;

/** Separate buttons, not a lookup — "does this mobile exist?" is not a question to answer. */
export type LoginStep =
  | { kind: 'signIn' }
  | { kind: 'mobile'; intent: OtpIntent }
  | { kind: 'code'; intent: OtpIntent; mobile: string; challenge: OtpRequestResponse }
  | { kind: 'pin'; intent: OtpIntent; mobile: string; ticket: PinSetupTicket };
