import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  fieldDiff,
  type CreateExamBody,
  type Exam,
  type ExamFamily,
  type ExamListQuery,
  type Paginated,
  type UpdateExamBody,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { type StudentsService } from '../students';
import { AuditContext } from '../audit';
import {
  examDeletionBlocker,
  examEditBlocker,
  INACTIVE_EXAM_MESSAGE,
  type ExamUsage,
} from './exam-rules';

interface ExamRow {
  id: string;
  family: ExamFamily;
  name: string;
  code: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  _count: { stages: number };
}

const EXAM_INCLUDE = {
  _count: { select: { stages: true } },
} as const satisfies Prisma.ExamInclude;

/** What an exam's audit diff covers — every column an edit can change. */
export const AUDITED_EXAM_FIELDS = ['family', 'name', 'code', 'description', 'isActive'] as const;

/** Owns `Exam` — the only module that writes it. */
@Injectable()
export class ExamsService {
  constructor(
    private readonly prisma: PrismaService,
    // `require`, not a static import: a top-level import here re-enters the still-loading `students`
    // barrel and throws; a CommonJS `require` tolerates the partial circular load instead.
    @Inject(
      forwardRef(
        () =>
          (module.require('../students') as { StudentsService: typeof StudentsService })
            .StudentsService,
      ),
    )
    private readonly students: StudentsService,
    private readonly auditContext: AuditContext,
  ) {}

  async list(query: ExamListQuery): Promise<Paginated<Exam>> {
    const where: Prisma.ExamWhereInput = {
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
      ...(query.family ? { family: query.family } : {}),
      ...(query.activeOnly ? { isActive: true } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.exam.findMany({
        where,
        include: EXAM_INCLUDE,
        orderBy: [{ family: 'asc' }, { name: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.exam.count({ where }),
    ]);

    return { items: rows.map(toExam), page: query.page, pageSize: query.pageSize, total };
  }

  async create(input: CreateExamBody): Promise<Exam> {
    await this.assertFree(input.name, input.code);

    const exam = await this.prisma.exam.create({
      data: {
        family: input.family,
        name: input.name,
        code: input.code,
        description: input.description ?? null,
      },
      include: EXAM_INCLUDE,
    });
    return toExam(exam);
  }

  async update(id: string, input: UpdateExamBody): Promise<Exam> {
    const exam = await this.requireExam(id);

    // The diff, not the body: a PATCH that re-sends the current code is not a code change, and
    // treating it as one would make the row uneditable forever.
    const changes = {
      ...(input.family !== undefined && input.family !== exam.family
        ? { family: input.family }
        : {}),
      ...(input.name !== undefined && input.name !== exam.name ? { name: input.name } : {}),
      ...(input.code !== undefined && input.code !== exam.code ? { code: input.code } : {}),
      ...(input.description !== undefined && (input.description ?? null) !== exam.description
        ? { description: input.description ?? null }
        : {}),
      ...(input.isActive !== undefined && input.isActive !== exam.isActive
        ? { isActive: input.isActive }
        : {}),
    };

    // Only a code change can be refused, and only an enrolment count answers that — so an
    // ordinary rename or retire does not pay for it.
    if (changes.code !== undefined) {
      const blocker = examEditBlocker(
        { studentCount: await this.students.countEnrolledIn(exam.code) },
        changes,
      );
      if (blocker) {
        throw new AppException(ErrorCodes.CONFLICT, blocker, { fieldErrors: { code: [blocker] } });
      }
    }

    if (changes.name !== undefined || changes.code !== undefined) {
      await this.assertFree(changes.name ?? exam.name, changes.code ?? exam.code, id);
    }

    const updated = await this.prisma.exam.update({
      where: { id },
      data: changes,
      include: EXAM_INCLUDE,
    });

    this.auditContext.setChanged(fieldDiff(exam, { ...exam, ...changes }, AUDITED_EXAM_FIELDS));

    return toExam(updated);
  }

  async remove(id: string): Promise<void> {
    const exam = await this.requireExam(id);

    const blocker = examDeletionBlocker(await this.usageOf(exam));
    if (blocker) throw new AppException(ErrorCodes.CONFLICT, blocker);

    await this.prisma.exam.delete({ where: { id } });
  }

  /**
   * Whether these codes may be attached to. The field key is a PARAMETER: the student form's
   * field is `enrolledExams`, and `applyFieldErrors` drops the wrong one.
   */
  async assertUsable(codes: string[], fieldKey: string): Promise<void> {
    if (codes.length === 0) return;

    const found = await this.prisma.exam.findMany({ where: { code: { in: codes } } });

    const missing = codes.filter((code) => !found.some((row) => row.code === code));
    if (missing.length > 0) {
      const message = `No such exam: ${missing.join(', ')}`;
      throw new AppException(ErrorCodes.VALIDATION_ERROR, message, {
        fieldErrors: { [fieldKey]: [message] },
      });
    }

    if (found.some((row) => !row.isActive)) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, INACTIVE_EXAM_MESSAGE, {
        fieldErrors: { [fieldKey]: [INACTIVE_EXAM_MESSAGE] },
      });
    }
  }

  private async requireExam(id: string): Promise<ExamRow> {
    const exam = await this.prisma.exam.findUnique({ where: { id }, include: EXAM_INCLUDE });
    if (!exam) throw new AppException(ErrorCodes.NOT_FOUND, 'No such exam');
    return exam;
  }

  private async usageOf(exam: ExamRow): Promise<ExamUsage> {
    return {
      stageCount: exam._count.stages,
      studentCount: await this.students.countEnrolledIn(exam.code),
    };
  }

  private async assertFree(name: string, code: string, exceptId?: string): Promise<void> {
    const [byName, byCode] = await Promise.all([
      this.prisma.exam.findFirst({ where: { name }, select: { id: true } }),
      this.prisma.exam.findUnique({ where: { code }, select: { id: true } }),
    ]);

    if (byName && byName.id !== exceptId) {
      throw new AppException(ErrorCodes.CONFLICT, 'That exam already exists', {
        fieldErrors: { name: ['That exam already exists'] },
      });
    }
    if (byCode && byCode.id !== exceptId) {
      throw new AppException(ErrorCodes.CONFLICT, 'That code is already taken', {
        fieldErrors: { code: ['That code is already taken'] },
      });
    }
  }
}

function toExam(row: ExamRow): Exam {
  return {
    id: row.id,
    family: row.family,
    name: row.name,
    code: row.code,
    description: row.description,
    isActive: row.isActive,
    stageCount: row._count.stages,
    createdAt: row.createdAt.toISOString(),
  };
}
