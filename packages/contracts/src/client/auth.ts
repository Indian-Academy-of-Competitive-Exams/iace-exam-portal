import { noContentSchema, type NoContent } from '../envelope';
import {
  AUTH_ROUTES,
  authIdentitySchema,
  authSessionResponseSchema,
  otpRequestResponseSchema,
  type AuthIdentity,
  type AuthSessionResponse,
  type OtpRequestResponse,
  type RequestAdminOtpInput,
  type RequestStudentOtpInput,
  type VerifyAdminOtpInput,
  type VerifyStudentOtpInput,
} from '../auth';
import type { ApiCore } from './core';

export function authClient(core: ApiCore) {
  const { request, get, write } = core;

  return {
    /** A student's sign-in, step 1: a code to their mobile. */
    requestStudentOtp: (input: RequestStudentOtpInput): Promise<OtpRequestResponse> =>
      request(AUTH_ROUTES.studentOtpRequest, {
        method: 'POST',
        body: input,
        schema: otpRequestResponseSchema,
        anonymous: true,
      }),

    /** Step 2 — the code back signs them in, as a new account when the number had none. */
    verifyStudentOtp: (input: VerifyStudentOtpInput): Promise<AuthSessionResponse> =>
      request(AUTH_ROUTES.studentOtpVerify, {
        method: 'POST',
        body: input,
        schema: authSessionResponseSchema,
        anonymous: true,
      }),

    requestAdminOtp: (input: RequestAdminOtpInput): Promise<OtpRequestResponse> =>
      request(AUTH_ROUTES.adminOtpRequest, {
        method: 'POST',
        body: input,
        schema: otpRequestResponseSchema,
        anonymous: true,
      }),

    verifyAdminOtp: (input: VerifyAdminOtpInput): Promise<AuthSessionResponse> =>
      request(AUTH_ROUTES.adminOtpVerify, {
        method: 'POST',
        body: input,
        schema: authSessionResponseSchema,
        anonymous: true,
      }),

    me: (): Promise<AuthIdentity> => get(AUTH_ROUTES.me, authIdentitySchema),

    /** The envelope's `success` is the whole answer; there is no payload. */
    logout: (): Promise<NoContent> => write('POST', AUTH_ROUTES.logout, noContentSchema),
  };
}
