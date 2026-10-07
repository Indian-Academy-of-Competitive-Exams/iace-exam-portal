/** The student sign-in both clients walk: a mobile, then the code sent to it. The first time is the signup. */
import { type OtpRequestResponse } from '@iace/contracts';

/** The fields each form owns; the server keys `fieldErrors` by the same names. */
export const LOGIN_FIELDS = {
  MOBILE: ['mobile'],
  CODE: ['code'],
} as const;

/** No "do you have an account?" fork: the same two steps serve a first visit and every one after. */
export type LoginStep =
  { kind: 'mobile' } | { kind: 'code'; mobile: string; challenge: OtpRequestResponse };
