import { Injectable } from '@nestjs/common';
import { type Me, type UpdateMeBody } from '@iace/contracts';
import { StudentsService } from '../students/students.service';

/**
 * The student's own account.
 *
 * Every method takes the id from the authenticated caller — never from a path
 * or a body — so there is no request shape that addresses somebody else's
 * record. Reading and editing reuse StudentsService rather than growing a
 * second copy: `preTestReady` and `profileCompleted` are stored columns, and a
 * second write path that forgot to recompute them would leave a student who
 * had just filled in their details still being asked for them.
 *
 * Changing the PIN is NOT here. It is a credential operation — it verifies the
 * old PIN, climbs the lockout ladder, revokes sessions and issues fresh tokens
 * — and all four of those live in AuthService. Reimplementing any of them here
 * is how one of them ends up subtly different from the login that shares it.
 */
@Injectable()
export class MeService {
  constructor(private readonly students: StudentsService) {}

  profile(studentId: string): Promise<Me> {
    return this.students.detail(studentId);
  }

  /** `groupIds` cannot arrive here — see updateMeSchema for why. */
  update(studentId: string, input: UpdateMeBody): Promise<Me> {
    return this.students.update(studentId, input);
  }
}
