import { z } from 'zod';
import { actorTypeSchema, emailSchema, mobileSchema, otpCodeSchema } from './common';

// ============================================================================
// OTP request — step 1 of login
// ============================================================================

/** Students log in with mobile + OTP. Unknown mobiles are provisioned on first
 *  successful verify (`mobile` is the only mandatory Student field). */
export const requestStudentOtpSchema = z.object({
  mobile: mobileSchema,
});
export type RequestStudentOtpInput = z.input<typeof requestStudentOtpSchema>;
export type RequestStudentOtpBody = z.infer<typeof requestStudentOtpSchema>;

/** Admins log in with email + OTP. The admin must already exist and be active —
 *  there is no self-signup. */
export const requestAdminOtpSchema = z.object({
  email: emailSchema,
});
export type RequestAdminOtpInput = z.input<typeof requestAdminOtpSchema>;
export type RequestAdminOtpBody = z.infer<typeof requestAdminOtpSchema>;

/** Deliberately reveals nothing about whether the identity exists. */
export const otpRequestResponseSchema = z.object({
  sent: z.literal(true),
  expiresInSec: z.number().int(),
  resendAfterSec: z.number().int(),
  /** Dev-only echo of the code — present only when the console sender is active. */
  devCode: z.string().optional(),
});
export type OtpRequestResponse = z.infer<typeof otpRequestResponseSchema>;

// ============================================================================
// OTP verify — step 2 of login
// ============================================================================

/** Optional client-supplied device label; the server binds the session to a
 *  fingerprint derived from this plus the request, and stores it in Redis. */
export const deviceInfoSchema = z
  .object({
    deviceId: z.string().max(128).optional(),
    deviceName: z.string().max(128).optional(),
  })
  .optional();

export const verifyStudentOtpSchema = z.object({
  mobile: mobileSchema,
  code: otpCodeSchema,
  device: deviceInfoSchema,
});
export type VerifyStudentOtpInput = z.input<typeof verifyStudentOtpSchema>;
export type VerifyStudentOtpBody = z.infer<typeof verifyStudentOtpSchema>;

export const verifyAdminOtpSchema = z.object({
  email: emailSchema,
  code: otpCodeSchema,
  device: deviceInfoSchema,
});
export type VerifyAdminOtpInput = z.input<typeof verifyAdminOtpSchema>;
export type VerifyAdminOtpBody = z.infer<typeof verifyAdminOtpSchema>;

// ============================================================================
// Tokens & identity
// ============================================================================

export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  /** Access-token lifetime, so clients can refresh proactively. */
  expiresInSec: z.number().int(),
});
export type AuthTokens = z.infer<typeof authTokensSchema>;

export const studentIdentitySchema = z.object({
  actor: z.literal('STUDENT'),
  id: z.string(),
  mobile: z.string(),
  fullName: z.string().nullable(),
  preferredLanguage: z.string(),
  /** Gates the first test: photo + DOB + gender + Aadhaar + PAN. */
  profileCompleted: z.boolean(),
});
export type StudentIdentity = z.infer<typeof studentIdentitySchema>;

export const adminIdentitySchema = z.object({
  actor: z.literal('ADMIN'),
  id: z.string(),
  email: z.string(),
  fullName: z.string().nullable(),
  isSuperAdmin: z.boolean(),
  /** Page codes this admin may access. Super admins bypass the check entirely. */
  pages: z.array(z.string()),
});
export type AdminIdentity = z.infer<typeof adminIdentitySchema>;

export const authIdentitySchema = z.discriminatedUnion('actor', [
  studentIdentitySchema,
  adminIdentitySchema,
]);
export type AuthIdentity = z.infer<typeof authIdentitySchema>;

export const authSessionResponseSchema = z.object({
  tokens: authTokensSchema,
  identity: authIdentitySchema,
});
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;

// ============================================================================
// Refresh / logout / me
// ============================================================================

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshTokenBody = z.infer<typeof refreshTokenSchema>;

export const logoutResponseSchema = z.object({ success: z.literal(true) });
export type LogoutResponse = z.infer<typeof logoutResponseSchema>;

/** Claims carried in the access token. Kept small on purpose. */
export const accessTokenClaimsSchema = z.object({
  sub: z.string(),
  actor: actorTypeSchema,
  sid: z.string(),
  isSuperAdmin: z.boolean().optional(),
  pages: z.array(z.string()).optional(),
});
export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;

/** Path segment used by the OTP endpoints, matching the two identity tables. */
export const AUTH_ROUTES = {
  studentOtpRequest: '/auth/student/otp/request',
  studentOtpVerify: '/auth/student/otp/verify',
  adminOtpRequest: '/auth/admin/otp/request',
  adminOtpVerify: '/auth/admin/otp/verify',
  refresh: '/auth/refresh',
  logout: '/auth/logout',
  me: '/auth/me',
} as const;
