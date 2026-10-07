import { z } from 'zod';
import { adminPermissionsSchema } from './admins';
import { ActorTypes, actorTypeSchema, emailSchema, mobileSchema, otpCodeSchema } from './common';

// ============================================================================
// OTP request. Everybody signs in with one: a student by mobile, an admin by
// email. A student's first is their signup — there is no second path.
// ============================================================================

/** How a student's code reaches them. One at a time: asking again may take the other, never both. */
export const OTP_CHANNELS = { SMS: 'SMS', WHATSAPP: 'WHATSAPP' } as const;
export const otpChannelSchema = z.enum(OTP_CHANNELS);
export type OtpChannel = z.infer<typeof otpChannelSchema>;

/** Signup and sign-in ask alike: the response is identical whether or not the number is registered, so it can't be used to find who has an account. */
export const requestStudentOtpSchema = z.object({
  mobile: mobileSchema,
  /** Which one to use this time. Absent, or one that is not set up, is the server's first choice. */
  channel: otpChannelSchema.optional(),
});
export type RequestStudentOtpInput = z.input<typeof requestStudentOtpSchema>;
export type RequestStudentOtpBody = z.infer<typeof requestStudentOtpSchema>;

/** Admins log in with email + OTP; the admin must already exist and be active — there is no self-signup. */
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
  /** Where a student's code went. Absent for an admin, whose code is always emailed. */
  channel: otpChannelSchema.optional(),
  /** The one a student may ask for instead. Absent where only one is set up. */
  otherChannel: otpChannelSchema.optional(),
  /** Dev-only echo of the code — present only when the console sender is active. */
  devCode: z.string().optional(),
});
export type OtpRequestResponse = z.infer<typeof otpRequestResponseSchema>;

// ============================================================================
// OTP verify
// ============================================================================

/** Which app a request comes from; a student keeps one session of each. */
export const CLIENT_KINDS = { WEB: 'WEB', MOBILE: 'MOBILE' } as const;
export const clientKindSchema = z.enum(CLIENT_KINDS);
export type ClientKind = z.infer<typeof clientKindSchema>;

/** Sent on every request by an app's API client, so every way a session starts knows its kind. */
export const CLIENT_HEADERS = { KIND: 'x-client', DEVICE_NAME: 'x-device-name' } as const;

/** Optional client-supplied device label, so a session listing names the phone rather than its user agent. */
const deviceInfoSchema = z.object({ deviceName: z.string().max(128).optional() }).optional();

/** Verifying signs the student in, as a new account when the number had none. */
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

/** The code step of a student's OTP flow, as both student clients validate it before sending. */
export const otpCodeFormSchema = z.object({ code: otpCodeSchema });

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

const studentIdentitySchema = z.object({
  actor: z.literal(ActorTypes.STUDENT),
  id: z.string(),
  mobile: z.string(),
  fullName: z.string().nullable(),
  /** The minimal pre-test details are on file: mother's name, father's name, DOB; when false the test player prompts for them — never a hard block. */
  preTestReady: z.boolean(),
  /** The FULL optional profile (photo, gender, Aadhaar, PAN, address, education); drives a gentle nudge only — it never gates anything. */
  profileCompleted: z.boolean(),
  /** Locked out of STARTING a test, not the account: they sign in, results and history stay readable — login is `isActive`, a different question this never answers. */
  isTestBlocked: z.boolean(),
});
export type StudentIdentity = z.infer<typeof studentIdentitySchema>;

const adminIdentitySchema = z.object({
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
// Active devices — see ME_ROUTES.sessions / session
// ============================================================================

/** One place a student is signed in. `current` marks the device asking. */
export const deviceSessionSchema = z.object({
  id: z.string(),
  client: clientKindSchema.nullable(),
  deviceName: z.string().nullable(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  current: z.boolean(),
});
export type DeviceSession = z.infer<typeof deviceSessionSchema>;

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
});
export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;

/** Every auth path, split by identity table — students and admins never share a route, because they never share a login method. */
export const AUTH_ROUTES = {
  /** Student sign-in, and signup with it: a code to the mobile, then the code back. */
  studentOtpRequest: '/auth/student/otp/request',
  studentOtpVerify: '/auth/student/otp/verify',
  adminOtpRequest: '/auth/admin/otp/request',
  adminOtpVerify: '/auth/admin/otp/verify',
  refresh: '/auth/refresh',
  logout: '/auth/logout',
  me: '/auth/me',
} as const;
