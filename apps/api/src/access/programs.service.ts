import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  fieldDiff,
  type CreateProgramBody,
  type Paginated,
  type Program,
  type ProgramListQuery,
  type UpdateProgramBody,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { everyTermMatches } from '../common/search-terms';
import { AuditContext } from '../audit';

interface ProgramRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
}

/** What a program's audit diff covers — every column an edit can change. */
export const AUDITED_PROGRAM_FIELDS = ['code', 'name', 'isActive'] as const;

export const INACTIVE_PROGRAM_MESSAGE =
  'That program is no longer offered. Pick another, or reactivate it first.';

/**
 * Owns `Program` — the coaching variants a student is a candidate for. Adding one is a row,
 * never a migration, which is the whole reason it is a table rather than an enum.
 */
@Injectable()
export class ProgramsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditContext: AuditContext,
  ) {}

  async list(query: ProgramListQuery): Promise<Paginated<Program>> {
    const where: Prisma.ProgramWhereInput = {
      ...everyTermMatches<Prisma.ProgramWhereInput>(query.q, (term) => [
        { code: { contains: term, mode: 'insensitive' } },
        { name: { contains: term, mode: 'insensitive' } },
      ]),
      ...(query.activeOnly ? { isActive: true } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.program.findMany({
        where,
        orderBy: [{ name: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.program.count({ where }),
    ]);

    return { items: rows.map(toProgram), page: query.page, pageSize: query.pageSize, total };
  }

  async create(input: CreateProgramBody): Promise<Program> {
    await this.assertCodeFree(input.code);

    const program = await this.prisma.program.create({
      data: { code: input.code, name: input.name },
    });
    return toProgram(program);
  }

  async update(id: string, input: UpdateProgramBody): Promise<Program> {
    const program = await this.requireProgram(id);

    const changes = {
      ...(input.code !== undefined && input.code !== program.code ? { code: input.code } : {}),
      ...(input.name !== undefined && input.name !== program.name ? { name: input.name } : {}),
      ...(input.isActive !== undefined && input.isActive !== program.isActive
        ? { isActive: input.isActive }
        : {}),
    };

    if (changes.code !== undefined) {
      const blocker = await this.codeChangeBlocker(program.code);
      if (blocker) {
        throw new AppException(ErrorCodes.CONFLICT, blocker, { fieldErrors: { code: [blocker] } });
      }
      await this.assertCodeFree(changes.code);
    }

    const updated = await this.prisma.program.update({ where: { id }, data: changes });

    this.auditContext.setChanged(
      fieldDiff(program, { ...program, ...changes }, AUDITED_PROGRAM_FIELDS),
    );

    return toProgram(updated);
  }

  async remove(id: string): Promise<void> {
    const program = await this.requireProgram(id);

    const blocker = await this.codeChangeBlocker(program.code, 'delete');
    if (blocker) throw new AppException(ErrorCodes.CONFLICT, blocker);

    await this.prisma.program.delete({ where: { id } });
  }

  /** Whether these codes may be attached to a student. The field key is a parameter. */
  async assertUsable(codes: string[], fieldKey: string): Promise<void> {
    if (codes.length === 0) return;

    const found = await this.prisma.program.findMany({ where: { code: { in: codes } } });

    const missing = codes.filter((code) => !found.some((row) => row.code === code));
    if (missing.length > 0) {
      const message = `No such program: ${missing.join(', ')}`;
      throw new AppException(ErrorCodes.VALIDATION_ERROR, message, {
        fieldErrors: { [fieldKey]: [message] },
      });
    }

    if (found.some((row) => !row.isActive)) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, INACTIVE_PROGRAM_MESSAGE, {
        fieldErrors: { [fieldKey]: [INACTIVE_PROGRAM_MESSAGE] },
      });
    }
  }

  /** Codes to the names the catalog gives them, for a screen that must print one rather than a code. */
  async namesByCode(codes: readonly string[]): Promise<Map<string, string>> {
    if (codes.length === 0) return new Map();
    const rows = await this.prisma.program.findMany({
      where: { code: { in: [...codes] } },
      select: { code: true, name: true },
    });
    return new Map(rows.map((row) => [row.code, row.name]));
  }

  private async requireProgram(id: string): Promise<ProgramRow> {
    const program = await this.prisma.program.findUnique({ where: { id } });
    if (!program) throw new AppException(ErrorCodes.NOT_FOUND, 'No such program');
    return program;
  }

  /**
   * `Student.programs` holds the code as free text with no foreign key, and a series holds it
   * too — so a rename or a delete detaches every one of them with no error and no rows changed.
   */
  private async codeChangeBlocker(code: string, verb = 'change'): Promise<string | null> {
    const [students, series] = await Promise.all([
      this.prisma.student.count({ where: { programs: { has: code } } }),
      this.prisma.testSeries.count({ where: { programCode: code } }),
    ]);

    const held: string[] = [];
    if (students > 0) held.push(`${students} ${students === 1 ? 'student' : 'students'}`);
    if (series > 0) held.push(`${series} series`);

    if (held.length === 0) return null;
    return `${held.join(' and ')} already carry ${code}, and nothing links them back to this row — a ${verb} would detach every one of them silently. Retire the program instead.`;
  }

  private async assertCodeFree(code: string): Promise<void> {
    const taken = await this.prisma.program.findUnique({ where: { code }, select: { id: true } });
    if (!taken) return;

    throw new AppException(ErrorCodes.CONFLICT, 'That program code is already taken', {
      fieldErrors: { code: ['That program code is already taken'] },
    });
  }
}

function toProgram(row: ProgramRow): Program {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}
