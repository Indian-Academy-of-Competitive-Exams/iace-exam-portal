import { Injectable } from '@nestjs/common';
import {
  type AdminPermissions,
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
import { AdminsService } from '../admins';
import { OtpService } from './otp/otp.service';
import { PinService } from './pin/pin.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { type AuthenticatedUser } from '../common/security';
import {
  DOMAIN_EVENTS,
  DomainEventBus,
  PIN_RESET_REASONS,
  type PinResetReason,
} from '../common/events';
import { type DeviceContext } from './auth.types';

/**
 * Owns `Admin` and `Page` (docs/03 §5) — and READS `Student` for credentials, which the students
 * module owns.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly pin: PinService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly events: DomainEventBus,
    private readonly admins: AdminsService,
  ) {}

  // ==========================================================================
  // Students — OTP once at signup, a 4-digit PIN every day after An SMS per login was the vendor's
  // habit and the students' complaint: it is slow, it costs money, and it fails exactly when the
  // hall is full and the network is not.
  // ==========================================================================

  /** Serves both signup and PIN reset. */
  async requestStudentOtp(mobile: string): Promise<OtpRequestResponse> {
    return this.otp.request(ActorTypes.STUDENT, mobile);
  }

  /** Proves the number and hands back a short-lived ticket. */
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
   * Redeems the ticket. One code path for both cases — signup creates the student, a reset
   * overwrites the hash — because they differ only in whether the row already exists.
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
      // pinIsDefault false in both branches: this PIN is the student's own, whether they are new or
      // replacing the one an import gave them.
      create: { mobile, pinHash, pinIsDefault: false },
      update: { pinHash, pinIsDefault: false },
    });
    if (!student.isActive)
      throw new AppException(ErrorCodes.FORBIDDEN, 'This account has been deactivated');

    // A new PIN ends every session opened with the old one — that is most of
    // the point of a reset — and clears any lockout the student hit first.
    await this.sessions.revokeAll(ActorTypes.STUDENT, student.id);
    await this.pin.clearFailures(mobile);
    this.announcePinReset(student.id, mobile, PIN_RESET_REASONS.OTP_RESET);

    const identity = this.studentIdentity(student);
    return { tokens: await this.issue(identity, device), identity };
  }

  /**
   * Replacing a PIN the student already knows. The current one is checked despite the
   * session: one left open on a shared machine would otherwise lock the owner out.
   * Wrong attempts climb the same ladder, and the response is a FRESH session.
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
    this.announcePinReset(studentId, student.mobile, PIN_RESET_REASONS.SELF_CHANGE);

    const identity = this.studentIdentity(updated);
    return { tokens: await this.issue(identity, device), identity };
  }

  /**
   * The everyday login. Unknown number, no PIN set and wrong PIN are one answer and one duration, so
   * neither the message nor the clock says whether the number is registered.
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

  /** No self-signup: the admin must already exist. */
  async requestAdminOtp(email: string): Promise<OtpRequestResponse> {
    const admin = await this.prisma.admin.findUnique({ where: { email } });
    if (!admin) {
      return {
        sent: true,
        expiresInSec: this.otpTtlPlaceholder,
        resendAfterSec: this.otpCooldownPlaceholder,
        codeLength: this.otpCodeLengthPlaceholder,
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

    // Deliberately NOT gated on isActive.
    const admin = await this.prisma.admin.findUnique({ where: { email } });
    if (!admin) {
      throw new AppException(ErrorCodes.UNAUTHENTICATED, 'Invalid credentials');
    }

    const identity: AuthIdentity = {
      actor: ActorTypes.ADMIN,
      id: admin.id,
      email: admin.email,
      fullName: admin.fullName,
      isSuperAdmin: admin.isSuperAdmin,
      isActive: admin.isActive,
      permissions: await this.adminGrants(admin),
    };

    return { tokens: await this.issue(identity, device), identity };
  }

  /**
   * Hashes a PIN the way a chosen one is hashed — same argon2 profile, same pepper — for the bulk
   * importer, which seeds a starting PIN so an uploaded roster can sign in the same day.
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
        ? {
            isSuperAdmin: identity.isSuperAdmin,
            isActive: identity.isActive,
            permissions: identity.permissions,
          }
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

  /** Announces a PIN change, AFTER the sessions are already revoked. */
  private announcePinReset(studentId: string, mobile: string, reason: PinResetReason): void {
    this.events.emit(DOMAIN_EVENTS.STUDENT_PIN_RESET, { studentId, mobile, reason });
  }

  private async issue(identity: AuthIdentity, device: DeviceContext): Promise<AuthTokens> {
    const sessionId = this.sessions.newSessionId();

    const accessToken = await this.tokens.signAccess({
      sub: identity.id,
      actor: identity.actor,
      sid: sessionId,
      ...(identity.actor === ActorTypes.ADMIN
        ? {
            isSuperAdmin: identity.isSuperAdmin,
            isActive: identity.isActive,
            permissions: identity.permissions,
          }
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

  /** `preTestReady` rides along on every identity read. */
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

    const admin = await this.prisma.admin.findUnique({ where: { id } });
    if (!admin) return null;
    return {
      actor: ActorTypes.ADMIN,
      id: admin.id,
      email: admin.email,
      fullName: admin.fullName,
      isSuperAdmin: admin.isSuperAdmin,
      isActive: admin.isActive,
      permissions: await this.adminGrants(admin),
    };
  }

  /** The grant map a token carries. */
  private async adminGrants(admin: {
    id: string;
    isSuperAdmin: boolean;
    isActive: boolean;
  }): Promise<AdminPermissions> {
    if (admin.isSuperAdmin || !admin.isActive) return {};
    return this.admins.permissionsFor(admin.id);
  }

  // Values echoed for unknown admins; they must match the real policy exactly
  // or the difference becomes an enumeration oracle.
  private get otpTtlPlaceholder(): number {
    return this.otp.ttlSec;
  }

  private get otpCooldownPlaceholder(): number {
    return this.otp.cooldownSec;
  }

  private get otpCodeLengthPlaceholder(): number {
    return this.otp.codeLength;
  }
}
