import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ADMIN_PAGES,
  ActorTypes,
  createStudentSchema,
  setStudentActiveSchema,
  studentListQuerySchema,
  updateStudentSchema,
  type CreateStudentBody,
  type Paginated,
  type SetStudentActiveBody,
  type StudentDetail,
  type StudentListQuery,
  type StudentSummary,
  type UpdateStudentBody,
} from '@iace/contracts';
import { Actors, RequiresPage } from '../auth/decorators';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { StudentsService } from './students.service';

/**
 * The admin-side student directory.
 *
 * `@Actors(ADMIN)` is the hard boundary — a student's token is a perfectly
 * valid JWT and must not reach here. `@RequiresPage` is the finer one; until
 * admin management exists there are no grants to hand out, and the seeded super
 * admin bypasses the check, so this is in place ready rather than idle.
 */
@Controller('admin/students')
@Actors(ActorTypes.ADMIN)
@RequiresPage(ADMIN_PAGES.STUDENTS_MANAGE)
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  /** Returns the list shape the response interceptor splits into data + meta. */
  @Get()
  list(
    @Query(new ZodQuery(studentListQuerySchema)) query: StudentListQuery,
  ): Promise<Paginated<StudentSummary>> {
    return this.students.list(query);
  }

  @Get(':id')
  detail(@Param('id') id: string): Promise<StudentDetail> {
    return this.students.detail(id);
  }

  @Post()
  create(@Body(new ZodBody(createStudentSchema)) body: CreateStudentBody): Promise<StudentDetail> {
    return this.students.create(body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodBody(updateStudentSchema)) body: UpdateStudentBody,
  ): Promise<StudentDetail> {
    return this.students.update(id, body);
  }

  @Patch(':id/active')
  setActive(
    @Param('id') id: string,
    @Body(new ZodBody(setStudentActiveSchema)) body: SetStudentActiveBody,
  ): Promise<StudentDetail> {
    return this.students.setActive(id, body.isActive);
  }
}
