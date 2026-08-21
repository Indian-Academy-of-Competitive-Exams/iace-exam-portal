import { z } from 'zod';
import { adminPermissionsSchema } from './admins';
import {
  ActorTypes,
  actorTypeSchema,
  emailSchema,
  mobileSchema,
  newPinSchema,
  otpCodeSchema,
  pinSchema,
} from './common';

// ============================================================================
// OTP request. Students meet one twice — signup, and a forgotten PIN. Admins,
// every time. Ordinary student login is mobile + 4-digit PIN.
// ============================================================================

/** One endpoint serves both student OTP cases (signup and PIN reset): the
 *  response is identical whether or not the number is already registered, so it
 *  cannot be used to find out who has an account. */
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
  /** How many digits the code has. The server decides, and the screen draws one box per digit. */
  codeLength: z.number().int().min(4).max(8),
  /** Dev-only echo of the code — present only when the console sender is active. */
  devCode: z.string().optional(),
});
export type OtpRequestResponse = z.infer<typeof otpRequestResponseSchema>;

// ============================================================================
// OTP verify
// ============================================================================

/** Optional client-supplied device label; the server binds the session to a
 *  fingerprint derived from this plus the request, and stores it in Redis. */
export const deviceInfoSchema = z
  .object({
    deviceId: z.string().max(128).optional(),
    deviceName: z.string().max(128).optional(),
  })
  .optional();

/** Verifying a student OTP does not sign anyone in — it proves the number and
 *  hands back a short-lived ticket to set a PIN. No device needed yet; the
 *  session is created when the PIN is set. */
export const verifyStudentOtpSchema = z.object({
  mobile: mobileSchema,
  code: otpCodeSchema,
});
export type VerifyStudentOtpInput = z.input<typeof verifyStudentOtpSchema>;
export type VerifyStudentOtpBody = z.infer<typeof verifyStudentOtpSchema>;

/** The ticket. Single-use, Redis-resident, and bound to the verified mobile. */
export const pinSetupTicketSchema = z.object({
  setupToken: z.string(),
  expiresInSec: z.number().int(),
  /** true = this is a PIN reset, false = a fresh signup. Safe to disclose: the
   *  caller just proved they hold the number. Only drives the wording. */
  pinAlreadySet: z.boolean(),
});
export type PinSetupTicket = z.infer<typeof pinSetupTicketSchema>;

export const verifyAdminOtpSchema = z.object({
  email: emailSchema,
  code: otpCodeSchema,
  device: deviceInfoSchema,
});
export type VerifyAdminOtpInput = z.input<typeof verifyAdminOtpSchema>;
export type VerifyAdminOtpBody = z.infer<typeof verifyAdminOtpSchema>;

// ============================================================================
// Student PIN — set (signup + reset) and login
// ============================================================================

/** Redeems the ticket: creates the student on signup, replaces the PIN on
 *  reset, and signs them in either way. */
export const setStudentPinSchema = z.object({
  mobile: mobileSchema,
  setupToken: z.string().min(1),
  pin: newPinSchema,
  device: deviceInfoSchema,
});
export type SetStudentPinInput = z.input<typeof setStudentPinSchema>;
export type SetStudentPinBody = z.infer<typeof setStudentPinSchema>;

/** The everyday path: no SMS, no waiting. Attempts are capped in Redis. */
export const studentLoginSchema = z.object({
  mobile: mobileSchema,
  pin: pinSchema,
  device: deviceInfoSchema,
});
export type StudentLoginInput = z.input<typeof studentLoginSchema>;
export type StudentLoginBody = z.infer<typeof studentLoginSchema>;

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
  actor: z.literal(ActorTypes.STUDENT),
  id: z.string(),
  mobile: z.string(),
  fullName: z.string().nullable(),
  /**
   * The minimal pre-test details are on file: mother's name, father's name, DOB.
   * When false the test player prompts for them — never a hard block.
   */
  preTestReady: z.boolean(),
  /**
   * Still on the PIN an import gave them, which anyone holding the roster can work out.
   * On the identity because the app must decide on the first render after sign-in.
   */
  hasDefaultPin: z.boolean(),
  /** The FULL optional profile (photo, gender, Aadhaar, PAN, address,
   *  education). Drives a gentle nudge only — it never gates anything. */
  profileCompleted: z.boolean(),
  /**
   * Locked out of STARTING a test, not out of the account: they sign in, and
   * their results and history stay readable. Login is `isActive`, which is a
   * different question and is never answered by this one.
   */
  isTestBlocked: z.boolean(),
});
export type StudentIdentity = z.infer<typeof studentIdentitySchema>;

export const adminIdentitySchema = z.object({
  actor: z.literal(ActorTypes.ADMIN),
  id: z.string(),
  email: z.string(),
  fullName: z.string().nullable(),
  isSuperAdmin: z.boolean(),
  /** A deactivated admin can still sign in — that is how they are told — but every check refuses them. */
  isActive: z.boolean(),
  /** By feature key, and only ever read together with `isSuperAdmin` — a super admin's is empty. */
  permissions: adminPermissionsSchema,
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

/** Claims carried in the access token. Kept small on purpose. */
export const accessTokenClaimsSchema = z.object({
  sub: z.string(),
  actor: actorTypeSchema,
  sid: z.string(),
  isSuperAdmin: z.boolean().optional(),
  /** Absent on a student token, and on an admin token issued before
   *  deactivation existed — both are read as active. */
  isActive: z.boolean().optional(),
  /** Carried in the token, so the guard costs nothing at request time. A grant
   *  change takes effect on the next refresh (<= the access TTL). */
  permissions: adminPermissionsSchema.optional(),
});
export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;

/** Every auth path, split by identity table — students and admins never share
 *  a route, because they never share a login method. */
export const AUTH_ROUTES = {
  /** Student signup + PIN reset (OTP), then the PIN itself. */
  studentOtpRequest: '/auth/student/otp/request',
  studentOtpVerify: '/auth/student/otp/verify',
  studentPinSet: '/auth/student/pin/set',
  /** Student everyday login: mobile + PIN. */
  studentLogin: '/auth/student/login',
  adminOtpRequest: '/auth/admin/otp/request',
  adminOtpVerify: '/auth/admin/otp/verify',
  refresh: '/auth/refresh',
  logout: '/auth/logout',
  me: '/auth/me',
} as const;
