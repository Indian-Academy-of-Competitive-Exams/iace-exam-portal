/**
 * The two DPDP rights the platform answers: a copy of what is held, and erasure. Both are about
 * ONE student, and the id is always the caller's or one an admin's branch scope already reaches.
 */
import { Inject, Injectable, forwardRef } from '@nestjs/common';
import {
  AppException,
  ErrorCodes,
  type ErasureReceipt,
  type StudentDataExport,
} from '@iace/contracts';
import { PrismaService, TX_LIMITS } from '../prisma/prisma.service';
import { DomainEventBus, DOMAIN_EVENTS } from '../common/events';
import { fromDateColumn } from '../common/time/institute-day';
import { type LeaderboardService } from '../attempts';
import { anonymizedProfile, anonymizedStudent } from './anonymize';

const NO_STUDENT = 'No such student';

const iso = (at: Date | null): string | null => at?.toISOString() ?? null;

@Injectable()
export class StudentPrivacyService {
  constructor(
    private readonly prisma: PrismaService,
    // `require`, not a static import: `attempts` reaches `configs`, which imports this barrel back.
    @Inject(
      forwardRef(
        () =>
          (module.require('../attempts') as { LeaderboardService: typeof LeaderboardService })
            .LeaderboardService,
      ),
    )
    private readonly leaderboard: LeaderboardService,
    private readonly events: DomainEventBus,
  ) {}

  /** Everything held about them, in one read they can keep. Their own sittings, never the papers. */
  async export(studentId: string): Promise<StudentDataExport> {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      include: { profile: true, currentBranch: { select: { name: true } } },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, NO_STUDENT);

    const [attempts, standings] = await Promise.all([
      this.prisma.attempt.findMany({
        where: { studentId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          testId: true,
          status: true,
          startedAt: true,
          submittedAt: true,
          score: true,
          test: { select: { title: true } },
        },
      }),
      this.leaderboard.standingsOfStudent(studentId),
    ]);

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
        dob: student.profile.dob ? fromDateColumn(student.profile.dob) : null,
        email: student.profile.email,
        address: student.profile.address,
        gender: student.profile.gender,
        photoUrl: student.profile.photoUrl,
        aadhaarVerified: student.profile.aadhaarVerified,
        panVerified: student.profile.panVerified,
        educationDetails: student.profile.educationDetails ?? null,
        pastExamHistory: student.profile.pastExamHistory ?? null,
      },
      attempts: attempts.map((attempt) => ({
        id: attempt.id,
        testId: attempt.testId,
        testName: attempt.test.title ?? attempt.testId,
        status: attempt.status,
        startedAt: iso(attempt.startedAt),
        submittedAt: iso(attempt.submittedAt),
        score: attempt.score === null ? null : Number(attempt.score),
        percentile: standings.get(attempt.id)?.percentile ?? null,
      })),
    };
  }

  /** One transaction: a nameless student whose profile still holds their mother's is worse than both. */
  async anonymize(studentId: string): Promise<ErasureReceipt> {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
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
    }, TX_LIMITS.SHORT);

    // An erased account keeps no session: this writes `isActive` itself, so `setActive` never sees it.
    this.events.emit(DOMAIN_EVENTS.STUDENT_DEACTIVATED, { studentId });

    return { studentId, anonymizedAt: at.toISOString(), attemptsKept };
  }
}
