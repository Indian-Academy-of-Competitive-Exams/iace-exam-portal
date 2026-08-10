import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  type ActorType,
  type AuthIdentity,
  type AuthSessionResponse,
  type AuthTokens,
  type OtpRequestResponse,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from './otp/otp.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { type AuthenticatedUser, type DeviceContext } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
  ) {}

  // ==========================================================================
  // Students — mobile + OTP
  // ==========================================================================

  /**
   * Unknown mobiles are accepted: a student record is created on first
   * successful verify (`mobile` is the only mandatory Student field). Deactivated
   * accounts still get "sent" so the endpoint reveals nothing.
   */
  async requestStudentOtp(mobile: string): Promise<OtpRequestResponse> {
    return this.otp.request('STUDENT', mobile);
  }

  async verifyStudentOtp(
    mobile: string,
    code: string,
    device: DeviceContext,
  ): Promise<AuthSessionResponse> {
    await this.otp.verify('STUDENT', mobile, code);

    // Verified ownership of the number is the signup step — nothing else to fill in.
    const student = await this.prisma.student.upsert({
      where: { mobile },
      create: { mobile },
      update: {},
    });
    if (!student.isActive) throw new ForbiddenException('This account has been deactivated');

    const identity: AuthIdentity = {
      actor: 'STUDENT',
      id: student.id,
      mobile: student.mobile,
      fullName: student.fullName,
      preferredLanguage: student.preferredLanguage,
      profileCompleted: student.profileCompleted,
    };

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
    if (!admin || !admin.isActive) {
      return {
        sent: true,
        expiresInSec: this.otpTtlPlaceholder,
        resendAfterSec: this.otpCooldownPlaceholder,
      };
    }
    return this.otp.request('ADMIN', email);
  }

  async verifyAdminOtp(
    email: string,
    code: string,
    device: DeviceContext,
  ): Promise<AuthSessionResponse> {
    await this.otp.verify('ADMIN', email, code);

    const admin = await this.prisma.admin.findUnique({
      where: { email },
      include: { pages: { select: { code: true } } },
    });
    if (!admin || !admin.isActive) throw new UnauthorizedException('Invalid credentials');

    const identity: AuthIdentity = {
      actor: 'ADMIN',
      id: admin.id,
      email: admin.email,
      fullName: admin.fullName,
      isSuperAdmin: admin.isSuperAdmin,
      pages: admin.pages.map((page) => page.code),
    };

    return { tokens: await this.issue(identity, device), identity };
  }

  // ==========================================================================
  // Session lifecycle
  // ==========================================================================

  /** Rotating refresh: every use mints a new pair and invalidates the old one. */
  async refresh(refreshToken: string, device: DeviceContext): Promise<AuthTokens> {
    const claims = await this.tokens.verifyRefresh(refreshToken);
    const identity = await this.loadIdentity(claims.actor, claims.sub);
    if (!identity) throw new UnauthorizedException('Account is no longer available');

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
      ...(identity.actor === 'ADMIN'
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
    if (!identity) throw new UnauthorizedException('Account is no longer available');
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
      ...(identity.actor === 'ADMIN'
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

  private async loadIdentity(actor: ActorType, id: string): Promise<AuthIdentity | null> {
    if (actor === 'STUDENT') {
      const student = await this.prisma.student.findUnique({ where: { id } });
      if (!student || !student.isActive) return null;
      return {
        actor: 'STUDENT',
        id: student.id,
        mobile: student.mobile,
        fullName: student.fullName,
        preferredLanguage: student.preferredLanguage,
        profileCompleted: student.profileCompleted,
      };
    }

    const admin = await this.prisma.admin.findUnique({
      where: { id },
      include: { pages: { select: { code: true } } },
    });
    if (!admin || !admin.isActive) return null;
    return {
      actor: 'ADMIN',
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
