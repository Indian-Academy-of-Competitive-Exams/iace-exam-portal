import { AppException, ErrorCodes } from '@iace/contracts';
import { type PrismaService } from '../prisma/prisma.service';

const NO_STUDENT = 'No such student';

/** A named student who is deleted or never existed reads as missing, not as an empty report. */
export async function requireStudent(
  prisma: PrismaService,
  studentId: string,
): Promise<{ createdAt: Date }> {
  const student = await prisma.student.findFirst({
    where: { id: studentId, deletedAt: null },
    select: { createdAt: true },
  });
  if (!student) throw new AppException(ErrorCodes.NOT_FOUND, NO_STUDENT);
  return student;
}
