/**
 * The three DPDP rights the platform answers: what was agreed to, a copy of
 * what is held, and erasure. All three are about ONE student, and the id is
 * always the caller's or one an admin's branch scope already reaches.
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  AppException,
  CONSENT_PURPOSE,
  ErrorCodes,
  type ConsentPurpose,
  type ConsentState,
  type ConsentStatus,
  type ErasureReceipt,
  type RecordConsentBody,
  type StudentDataExport,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/app-config.service';
import { branchScopeWhere, type BranchScope } from '../common/security';
import { anonymizedProfile, anonymizedStudent } from './anonymize';

const NO_STUDENT = 'No such student';

const iso = (at: Date | null): string | null => at?.toISOString() ?? null;

@Injectable()
export class StudentPrivacyService {
  private readonly logger = new Logger(StudentPrivacyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  /** The version of the notice in force. A record older than this is a student worth asking again. */
  get currentVersion(): string {
    return this.config.get('CONSENT_VERSION');
  }

  /** Called where consent is actually given, so a failure there never blocks a signup. */
  async record(studentId: string, body: RecordConsentBody): Promise<ConsentState> {
    const row = await this.prisma.studentConsent.create({
      data: {
        studentId,
        purpose: body.purpose,
        version: body.version,
        granted: body.granted,
      },
    });

    return {
      purpose: row.purpose,
      version: row.version,
      granted: row.granted,
      recordedAt: row.recordedAt.toISOString(),
    };
  }

  /** Signup IS the consent event, and a record that failed to write must not cost the account. */
  async recordAtSignup(studentId: string): Promise<void> {
    try {
      await this.record(studentId, {
        purpose: CONSENT_PURPOSE.PLATFORM,
        version: this.currentVersion,
        granted: true,
      });
    } catch (error) {
      this.logger.error(`Consent not recorded for student ${studentId}`, error);
    }
  }

  async status(studentId: string): Promise<ConsentStatus> {
    return { current: this.currentVersion, records: await this.latestPerPurpose(studentId) };
  }

  /** One row per purpose — the newest, because a purpose is answered again whenever it changes. */
  private async latestPerPurpose(studentId: string): Promise<ConsentState[]> {
    const rows = await this.prisma.studentConsent.findMany({
      where: { studentId },
      orderBy: { recordedAt: 'desc' },
    });

    const newest = new Map<ConsentPurpose, ConsentState>();
    for (const row of rows) {
      if (newest.has(row.purpose)) continue;
      newest.set(row.purpose, {
        purpose: row.purpose,
        version: row.version,
        granted: row.granted,
        recordedAt: row.recordedAt.toISOString(),
      });
    }
    return [...newest.values()];
  }

  /** Everything held about them, in one read they can keep. Their own sittings, never the papers. */
  async export(studentId: string): Promise<StudentDataExport> {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      include: { profile: true, currentBranch: { select: { name: true } } },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, NO_STUDENT);

    const attempts = await this.prisma.attempt.findMany({
      where: { studentId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        testId: true,
        status: true,
        startedAt: true,
        submittedAt: true,
        score: true,
        lastPercentile: true,
        test: { select: { title: true } },
      },
    });

    return {
      exportedAt: new Date().toISOString(),
      student: {
        id: student.id,
        mobile: student.mobile,
        fullName: student.fullName,
        studentType: student.studentType,
        branch: student.currentBranch?.name ?? null,
        enrolledExams: student.enrolledExams,
        enrolledCourses: student.enrolledCourses,
        programs: student.programs,
        createdAt: student.createdAt.toISOString(),
      },
      profile: student.profile && {
        motherName: student.profile.motherName,
        fatherName: student.profile.fatherName,
        // A `@db.Date` column is a civil date at UTC midnight, so it is read as one.
        dob: student.profile.dob?.toISOString().slice(0, 10) ?? null,
        email: student.profile.email,
        address: student.profile.address,
        gender: student.profile.gender,
        photoUrl: student.profile.photoUrl,
        aadhaarVerified: student.profile.aadhaarVerified,
        panVerified: student.profile.panVerified,
        educationDetails: student.profile.educationDetails ?? null,
        pastExamHistory: student.profile.pastExamHistory ?? null,
      },
      consents: await this.latestPerPurpose(studentId),
      attempts: attempts.map((attempt) => ({
        id: attempt.id,
        testId: attempt.testId,
        testName: attempt.test.title ?? attempt.testId,
        status: attempt.status,
        startedAt: iso(attempt.startedAt),
        submittedAt: iso(attempt.submittedAt),
        score: attempt.score === null ? null : Number(attempt.score),
        percentile: attempt.lastPercentile === null ? null : Number(attempt.lastPercentile),
      })),
    };
  }

  /** One transaction: a nameless student whose profile still holds their mother's is worse than both. */
  async anonymize(studentId: string, scope: BranchScope): Promise<ErasureReceipt> {
    const reachable = branchScopeWhere(scope);
    const student = await this.prisma.student.findFirst({
      where: {
        id: studentId,
        deletedAt: null,
        ...(reachable ? { currentBranchId: reachable } : {}),
      },
      select: { id: true, anonymizedAt: true },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, NO_STUDENT);
    if (student.anonymizedAt) {
      throw new AppException(ErrorCodes.CONFLICT, 'That student has already been erased');
    }

    const at = new Date();
    const attemptsKept = await this.prisma.$transaction(async (tx) => {
      await tx.student.update({ where: { id: studentId }, data: anonymizedStudent(at) });
      await tx.studentProfile.updateMany({ where: { studentId }, data: anonymizedProfile() });
      return tx.attempt.count({ where: { studentId } });
    });

    return { studentId, anonymizedAt: at.toISOString(), attemptsKept };
  }
}
