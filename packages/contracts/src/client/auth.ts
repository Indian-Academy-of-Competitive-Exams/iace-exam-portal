import { noContentSchema, type NoContent } from '../envelope';
import {
  AUTH_ROUTES,
  authIdentitySchema,
  authSessionResponseSchema,
  otpRequestResponseSchema,
  pinSetupTicketSchema,
  type AuthIdentity,
  type AuthSessionResponse,
  type OtpRequestResponse,
  type PinSetupTicket,
  type RequestAdminOtpInput,
  type RequestStudentOtpInput,
  type SetStudentPinInput,
  type StudentLoginInput,
  type VerifyAdminOtpInput,
  type VerifyStudentOtpInput,
} from '../auth';
import type { ApiCore } from './core';

export function authClient(core: ApiCore) {
  const { request, get, write } = core;

  return {
    /** Student signup or PIN reset, step 1. */
    requestStudentOtp: (input: RequestStudentOtpInput): Promise<OtpRequestResponse> =>
      request(AUTH_ROUTES.studentOtpRequest, {
        method: 'POST',
        body: input,
        schema: otpRequestResponseSchema,
        anonymous: true,
      }),

    /** Step 2 — proves the number and returns a ticket, not a session. */
    verifyStudentOtp: (input: VerifyStudentOtpInput): Promise<PinSetupTicket> =>
      request(AUTH_ROUTES.studentOtpVerify, {
        method: 'POST',
        body: input,
        schema: pinSetupTicketSchema,
        anonymous: true,
      }),

    /** Step 3 — redeems the ticket, stores the PIN and signs the student in. */
    setStudentPin: (input: SetStudentPinInput): Promise<AuthSessionResponse> =>
      request(AUTH_ROUTES.studentPinSet, {
        method: 'POST',
        body: input,
        schema: authSessionResponseSchema,
        anonymous: true,
      }),

    /** The everyday student login: mobile + 4-digit PIN, no OTP. */
    loginStudent: (input: StudentLoginInput): Promise<AuthSessionResponse> =>
      request(AUTH_ROUTES.studentLogin, {
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
