import { Injectable } from '@nestjs/common';
import {
  ActorTypes,
  AppException,
  ErrorCodes,
  READINESS_PROFILE_SELECT,
  STUDENT_TYPE,
  readinessOf,
  type ActorType,
  type AuthIdentity,
  type AuthSessionResponse,
  type AuthTokens,
  type DeviceSession,
  type OtpChannel,
  type OtpRequestResponse,
  type StudentIdentity,
} from '@iace/contracts';
import { type Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdminsService } from '../admins';
import { OtpService } from './otp/otp.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { type AuthenticatedUser } from '../common/security';
import { DOMAIN_EVENTS, DomainEventBus } from '../common/events';
import { isUniqueViolation } from '../common/prisma-errors';
import { AUTH_OUTCOMES, MetricsService } from '../common/metrics/metrics.service';
import { type DeviceContext } from './auth.types';

/** Owns no table (docs/03 §5): it READS `Student` for credentials, which the students module owns. */
const DEACTIVATED_MESSAGE = 'This account has been deactivated';

/** An identity carries the readiness flags, which are read off the profile rather than stored. */
const IDENTITY_INCLUDE = {
  profile: { select: READINESS_PROFILE_SELECT },
} as const satisfies Prisma.StudentInclude;

type IdentityRow = Prisma.StudentGetPayload<{ include: typeof IDENTITY_INCLUDE }>;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly events: DomainEventBus,
    private readonly admins: AdminsService,
    private readonly metrics: MetricsService,
  ) {}

  // ==========================================================================
  // Students — a code on every sign-in, and the first one is the signup. Kept rare by what
  // surrounds it: one long-lived session per app, so a device asks once and not each morning.
  // ==========================================================================

  /** One answer whoever asks; only which day's budget pays differs, by whether the number holds an account. */
  async requestStudentOtp(
    mobile: string,
    ip = 'unknown',
    channel?: OtpChannel,
  ): Promise<OtpRequestResponse> {
    const holder = await this.prisma.student.findFirst({
      where: { mobile, deletedAt: null },
      select: { id: true },
    });
    return this.otp.request(ActorTypes.STUDENT, mobile, ip, {
      holdsAccount: holder !== null,
      channel,
    });
  }

  /** Signs in whoever proved the number, and makes their account if the number had none: signup and sign-in are one path. */
  async verifyStudentOtp(
    mobile: string,
    code: string,
    device: DeviceContext,
  ): Promise<AuthSessionResponse> {
    try {
      await this.otp.verify(ActorTypes.STUDENT, mobile, code);
    } catch (error) {
      this.metrics.countAuthAttempt(AUTH_OUTCOMES.BAD_CODE);
      throw error;
    }

    const student = (await this.liveStudent(mobile)) ?? (await this.signUp(mobile));
    if (!student.isActive) {
      this.metrics.countAuthAttempt(AUTH_OUTCOMES.DEACTIVATED);
      throw new AppException(ErrorCodes.FORBIDDEN, DEACTIVATED_MESSAGE);
    }
    this.metrics.countAuthAttempt(AUTH_OUTCOMES.OK);

    const identity = this.studentIdentity(student);
    return { tokens: await this.issue(identity, device), identity };
  }

  /** For a student standing at the desk whose code did not arrive: read out, never sent, and good once. */
  async issueStudentDeskCode(studentId: string): Promise<{ code: string; expiresInSec: number }> {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      select: { mobile: true, isActive: true },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');
    if (!student.isActive) throw new AppException(ErrorCodes.CONFLICT, DEACTIVATED_MESSAGE);
    return this.otp.issueDeskCode(student.mobile);
  }

  // ==========================================================================
  // Admins — email + OTP
  // ==========================================================================

  /** No self-signup, so an unknown email is told so rather than answered with a success: a silent "sent" left somebody waiting for a code that was never going to arrive. */
  async requestAdminOtp(email: string): Promise<OtpRequestResponse> {
    const admin = await this.prisma.admin.findUnique({ where: { email } });
    if (!admin) {
      throw new AppException(ErrorCodes.ADMIN_NOT_REGISTERED, undefined, {
        fieldErrors: {
          email: ['That email has no admin account. Ask a super admin to create one for you.'],
        },
      });
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
    const admin = await this.prisma.admin.findUnique({ where: { email }, select: { id: true } });
    const identity = admin && (await this.admins.identityOf(admin.id));
    if (!identity) throw new AppException(ErrorCodes.UNAUTHENTICATED, 'Invalid credentials');

    return { tokens: await this.issue(identity, device), identity };
  }

  // ==========================================================================
  // Session lifecycle
  // ==========================================================================

  /** Rotating refresh: every use mints a new pair, and the old token only answers a retry inside the grace window. */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    const claims = await this.tokens.verifyRefresh(refreshToken);
    if (!(await this.mayRefresh(claims.actor, claims.sub)))
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
      this.tokens.refreshTtlSec,
    );

    const accessToken = await this.tokens.signAccess({
      sub: claims.sub,
      actor: claims.actor,
      sid: claims.sid,
    });

    return { accessToken, refreshToken: nextRefresh, expiresInSec: this.tokens.accessTtlSec };
  }

  async logout(user: AuthenticatedUser): Promise<void> {
    await this.sessions.revoke(user.actor, user.id, user.sessionId);
  }

  async activeDevices(user: AuthenticatedUser): Promise<DeviceSession[]> {
    return this.sessions.devicesFor(user.actor, user.id, user.sessionId);
  }

  async signOutDevice(user: AuthenticatedUser, sessionId: string): Promise<void> {
    await this.sessions.signOutOther(user.actor, user.id, user.sessionId, sessionId);
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

  private liveStudent(mobile: string): Promise<IdentityRow | null> {
    return this.prisma.student.findFirst({
      where: { mobile, deletedAt: null },
      include: IDENTITY_INCLUDE,
    });
  }

  /** Signed themselves up, so they are outside the institute: ONLINE is a branch of ours. */
  private async signUp(mobile: string): Promise<IdentityRow> {
    try {
      const student = await this.prisma.student.create({
        data: { mobile, studentType: STUDENT_TYPE.NON_IACE },
        include: IDENTITY_INCLUDE,
      });
      this.events.emit(DOMAIN_EVENTS.STUDENT_SIGNED_UP, { studentId: student.id });
      return student;
    } catch (error) {
      // The number was taken since the read and their code is spent: they get the account that won it.
      const winner = isUniqueViolation(error) ? await this.liveStudent(mobile) : null;
      if (!winner) throw error;
      return winner;
    }
  }

  private async issue(identity: AuthIdentity, device: DeviceContext): Promise<AuthTokens> {
    const sessionId = this.sessions.newSessionId();

    const accessToken = await this.tokens.signAccess({
      sub: identity.id,
      actor: identity.actor,
      sid: sessionId,
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
  private studentIdentity(student: IdentityRow): StudentIdentity {
    return {
      actor: ActorTypes.STUDENT,
      id: student.id,
      mobile: student.mobile,
      fullName: student.fullName,
      ...readinessOf(student.profile),
      isTestBlocked: student.isTestBlocked,
    };
  }

  /** Whether the account is still there, and no more: every sitting refreshes mid-paper, so this reads one column. */
  private async mayRefresh(actor: ActorType, id: string): Promise<boolean> {
    if (actor !== ActorTypes.STUDENT) return (await this.admins.identityOf(id)) !== null;

    const student = await this.prisma.student.findUnique({
      where: { id },
      select: { isActive: true },
    });
    return student?.isActive === true;
  }

  private async loadIdentity(actor: ActorType, id: string): Promise<AuthIdentity | null> {
    if (actor === ActorTypes.STUDENT) {
      const student = await this.prisma.student.findUnique({
        where: { id },
        include: IDENTITY_INCLUDE,
      });
      if (!student?.isActive) return null;
      return this.studentIdentity(student);
    }

    return this.admins.identityOf(id);
  }
}
