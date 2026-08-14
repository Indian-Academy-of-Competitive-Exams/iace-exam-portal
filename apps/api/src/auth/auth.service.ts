import { Injectable } from '@nestjs/common';
import {
  ActorTypes,
  AppException,
  ErrorCodes,
  type ActorType,
  type AuthIdentity,
  type AuthSessionResponse,
  type AuthTokens,
  type OtpRequestResponse,
  type PinSetupTicket,
  type StudentIdentity,
} from '@iace/contracts';
import { type Student } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from './otp/otp.service';
import { PinService } from './pin/pin.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { type AuthenticatedUser } from '../common/security';
import { type DeviceContext } from './auth.types';

/**
 * Owns `Admin` and `Page` (docs/03 §5) — and READS `Student` for credentials,
 * which the students module owns. That split is deliberate: a PIN hash is a
 * credential, not profile data, and putting login behind the students facade
 * would make the students module a dependency of every sign-in.
 *
 * Sessions, OTP codes and device binding are Redis-only and are never written
 * to Postgres at all.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly pin: PinService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
  ) {}

  // ==========================================================================
  // Students — OTP once at signup, a 4-digit PIN every day after
  //
  // An SMS per login was the vendor's habit and the students' complaint: it is
  // slow, it costs money, and it fails exactly when the hall is full and the
  // network is not. So the OTP proves the number once (and again if the PIN is
  // forgotten); the PIN carries every ordinary login.
  // ==========================================================================

  /**
   * Serves both signup and PIN reset. Any valid-looking mobile gets a code —
   * registered or not, active or not — so the endpoint answers identically in
   * every case and cannot be used to discover who has an account.
   */
  async requestStudentOtp(mobile: string): Promise<OtpRequestResponse> {
    return this.otp.request(ActorTypes.STUDENT, mobile);
  }

  /**
   * Proves the number and hands back a short-lived ticket. Deliberately does
   * NOT sign anyone in: the account does not exist until a PIN is chosen, so
   * an abandoned signup leaves no half-made student behind.
   */
  async verifyStudentOtp(mobile: string, code: string): Promise<PinSetupTicket> {
    await this.otp.verify(ActorTypes.STUDENT, mobile, code);

    const student = await this.prisma.student.findUnique({
      where: { mobile },
      select: { pinHash: true, isActive: true },
    });
    if (student && !student.isActive) {
      throw new AppException(ErrorCodes.FORBIDDEN, 'This account has been deactivated');
    }

    return {
      ...(await this.pin.issueSetupToken(mobile)),
      pinAlreadySet: student?.pinHash != null,
    };
  }

  /**
   * Redeems the ticket. One code path for both cases — signup creates the
   * student, a reset overwrites the hash — because they differ only in whether
   * the row already exists.
   */
  async setStudentPin(
    mobile: string,
    setupToken: string,
    pin: string,
    device: DeviceContext,
  ): Promise<AuthSessionResponse> {
    await this.pin.consumeSetupToken(mobile, setupToken);

    const pinHash = await this.pin.hash(pin);
    const student = await this.prisma.student.upsert({
      where: { mobile },
      // pinIsDefault false in both branches: this PIN is the student's own,
      // whether they are new or replacing the one an import gave them. Leaving
      // it set would keep prompting them to change a PIN they just chose.
      create: { mobile, pinHash, pinIsDefault: false },
      update: { pinHash, pinIsDefault: false },
    });
    if (!student.isActive)
      throw new AppException(ErrorCodes.FORBIDDEN, 'This account has been deactivated');

    // A new PIN ends every session opened with the old one — that is most of
    // the point of a reset — and clears any lockout the student hit first.
    await this.sessions.revokeAll(ActorTypes.STUDENT, student.id);
    await this.pin.clearFailures(mobile);

    const identity = this.studentIdentity(student);
    return { tokens: await this.issue(identity, device), identity };
  }

  /**
   * Replacing a PIN the student already knows.
   *
   * The current one is checked even though the caller holds a valid session: an
   * open session on a shared machine — a library, a friend's phone — would
   * otherwise be enough to lock the real owner out of their own account. Wrong
   * attempts climb the same lockout ladder as login, so this cannot be used as
   * an unlimited oracle for guessing a PIN that login refuses to let you guess.
   *
   * Returns a FRESH session. Every other one dies with the old PIN — that is
   * most of the point — but signing the student out of the device they are
   * standing at, as a punishment for doing the safe thing, is not.
   */
  async changeStudentPin(
    studentId: string,
    currentPin: string,
    newPin: string,
    device: DeviceContext,
  ): Promise<AuthSessionResponse> {
    const student = await this.prisma.student.findUnique({ where: { id: studentId } });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');

    await this.pin.assertNotLocked(student.mobile);

    // Burns the same time when there is no PIN to check against, so the clock
    // never says whether one is set.
    const ok = student.pinHash
      ? await this.pin.verify(student.pinHash, currentPin)
      : await this.pin.burnVerifyTime().then(() => false);

    if (!ok) {
      await this.pin.registerFailure(student.mobile);
      throw new AppException(ErrorCodes.PIN_INVALID, 'That is not your current PIN', {
        fieldErrors: { currentPin: ['That is not your current PIN'] },
      });
    }

    const updated = await this.prisma.student.update({
      where: { id: studentId },
      data: {
        pinHash: await this.pin.hash(newPin),
        // Theirs now, whatever it was before. This is what stops an imported
        // student being asked to change a PIN they have just chosen.
        pinIsDefault: false,
      },
    });

    await this.sessions.revokeAll(ActorTypes.STUDENT, studentId);
    await this.pin.clearFailures(student.mobile);

    const identity = this.studentIdentity(updated);
    return { tokens: await this.issue(identity, device), identity };
  }

  /**
   * The everyday login. Unknown number, no PIN set and wrong PIN are one
   * answer and one duration, so neither the message nor the clock says whether
   * the number is registered.
   */
  async loginStudent(
    mobile: string,
    pin: string,
    device: DeviceContext,
  ): Promise<AuthSessionResponse> {
    await this.pin.assertNotLocked(mobile);

    const student = await this.prisma.student.findUnique({ where: { mobile } });
    const ok = student?.pinHash
      ? await this.pin.verify(student.pinHash, pin)
      : await this.pin.burnVerifyTime().then(() => false);

    if (!ok || !student) {
      await this.pin.registerFailure(mobile);
      throw new AppException(ErrorCodes.PIN_INVALID, 'Incorrect mobile number or PIN');
    }
    if (!student.isActive)
      throw new AppException(ErrorCodes.FORBIDDEN, 'This account has been deactivated');

    await this.pin.clearFailures(mobile);

    const identity = this.studentIdentity(student);
    return { tokens: await this.issue(identity, device), identity };
  }

  // ==========================================================================
  // Admins — email + OTP
  // ==========================================================================

  /**
   * No self-signup: the admin must already exist and be active. The response is
   * identical either way so the endpoint can't be used to enumerate admins —
   * an unknown address simply never receives a code.
   */
  async requestAdminOtp(email: string): Promise<OtpRequestResponse> {
    const admin = await this.prisma.admin.findUnique({ where: { email } });
    if (!admin?.isActive) {
      return {
        sent: true,
        expiresInSec: this.otpTtlPlaceholder,
        resendAfterSec: this.otpCooldownPlaceholder,
      };
    }
    return this.otp.request(ActorTypes.ADMIN, email);
  }

  async verifyAdminOtp(
    email: string,
    code: string,
    device: DeviceContext,
  ): Promise<AuthSessionResponse> {
    await this.otp.verify(ActorTypes.ADMIN, email, code);

    const admin = await this.prisma.admin.findUnique({
      where: { email },
      include: { pages: { select: { code: true } } },
    });
    if (!admin?.isActive) throw new AppException(ErrorCodes.UNAUTHENTICATED, 'Invalid credentials');

    const identity: AuthIdentity = {
      actor: ActorTypes.ADMIN,
      id: admin.id,
      email: admin.email,
      fullName: admin.fullName,
      isSuperAdmin: admin.isSuperAdmin,
      pages: admin.pages.map((page) => page.code),
    };

    return { tokens: await this.issue(identity, device), identity };
  }

  /**
   * Hashes a PIN the way a chosen one is hashed — same argon2 profile, same
   * pepper — for the bulk importer, which seeds a starting PIN so an uploaded
   * roster can sign in the same day.
   *
   * A facade method rather than the importer reaching for `PinService`
   * directly (docs/03 §4.1). The pepper and the cost parameters are auth's, and
   * the day either changes, every hash in the system has to change with it: a
   * second module holding its own reference to the hasher is how one of them
   * quietly keeps the old settings.
   */
  hashPin(pin: string): Promise<string> {
    return this.pin.hash(pin);
  }

  // ==========================================================================
  // Session lifecycle
  // ==========================================================================

  /** Rotating refresh: every use mints a new pair and invalidates the old one. */
  async refresh(refreshToken: string, device: DeviceContext): Promise<AuthTokens> {
    const claims = await this.tokens.verifyRefresh(refreshToken);
    const identity = await this.loadIdentity(claims.actor, claims.sub);
    if (!identity)
      throw new AppException(ErrorCodes.UNAUTHENTICATED, 'Account is no longer available');

    const nextRefresh = await this.tokens.signRefresh({
      sub: claims.sub,
      actor: claims.actor,
      sid: claims.sid,
    });

    await this.sessions.rotate(
      claims.actor,
      claims.sub,
      claims.sid,
      refreshToken,
      nextRefresh,
      device,
      this.tokens.refreshTtlSec,
    );

    const accessToken = await this.tokens.signAccess({
      sub: identity.id,
      actor: identity.actor,
      sid: claims.sid,
      ...(identity.actor === ActorTypes.ADMIN
        ? { isSuperAdmin: identity.isSuperAdmin, pages: identity.pages }
        : {}),
    });

    return { accessToken, refreshToken: nextRefresh, expiresInSec: this.tokens.accessTtlSec };
  }

  async logout(user: AuthenticatedUser): Promise<void> {
    await this.sessions.revoke(user.actor, user.id, user.sessionId);
  }

  /** Read fresh from Postgres, so a permission change lands without re-login. */
  async me(user: AuthenticatedUser): Promise<AuthIdentity> {
    const identity = await this.loadIdentity(user.actor, user.id);
    if (!identity)
      throw new AppException(ErrorCodes.UNAUTHENTICATED, 'Account is no longer available');
    return identity;
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  private async issue(identity: AuthIdentity, device: DeviceContext): Promise<AuthTokens> {
    const sessionId = this.sessions.newSessionId();

    const accessToken = await this.tokens.signAccess({
      sub: identity.id,
      actor: identity.actor,
      sid: sessionId,
      ...(identity.actor === ActorTypes.ADMIN
        ? { isSuperAdmin: identity.isSuperAdmin, pages: identity.pages }
        : {}),
    });
    const refreshToken = await this.tokens.signRefresh({
      sub: identity.id,
      actor: identity.actor,
      sid: sessionId,
    });

    await this.sessions.create(
      identity.actor,
      identity.id,
      sessionId,
      refreshToken,
      device,
      this.tokens.refreshTtlSec,
    );

    return { accessToken, refreshToken, expiresInSec: this.tokens.accessTtlSec };
  }

  /**
   * `preTestReady` rides along on every identity read.
   * TODO(pre-test gate): the attempt-start endpoint refuses (or rather, prompts)
   * on `preTestReady === false` once the test engine exists — mother's name,
   * father's name and DOB are collected there, then the flag is recomputed.
   */
  private studentIdentity(student: Student): StudentIdentity {
    return {
      actor: ActorTypes.STUDENT,
      id: student.id,
      mobile: student.mobile,
      fullName: student.fullName,
      preferredLanguage: student.preferredLanguage,
      preTestReady: student.preTestReady,
      profileCompleted: student.profileCompleted,
      hasDefaultPin: student.pinIsDefault,
    };
  }

  private async loadIdentity(actor: ActorType, id: string): Promise<AuthIdentity | null> {
    if (actor === ActorTypes.STUDENT) {
      const student = await this.prisma.student.findUnique({ where: { id } });
      if (!student?.isActive) return null;
      return this.studentIdentity(student);
    }

    const admin = await this.prisma.admin.findUnique({
      where: { id },
      include: { pages: { select: { code: true } } },
    });
    if (!admin?.isActive) return null;
    return {
      actor: ActorTypes.ADMIN,
      id: admin.id,
      email: admin.email,
      fullName: admin.fullName,
      isSuperAdmin: admin.isSuperAdmin,
      pages: admin.pages.map((page) => page.code),
    };
  }

  // Values echoed for unknown admins; they must match the real policy exactly
  // or the difference becomes an enumeration oracle.
  private get otpTtlPlaceholder(): number {
    return this.otp.ttlSec;
  }

  private get otpCooldownPlaceholder(): number {
    return this.otp.cooldownSec;
  }
}
