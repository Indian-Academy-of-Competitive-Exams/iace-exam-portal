import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  FEATURE_KEYS,
  PERMISSION_LEVELS,
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
import { Actors, RequiresFeature } from '../common/security';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { StudentsService } from './students.service';

/**
 * The admin-side student directory.
 *
 * `@Actors(ADMIN)` is the hard boundary — a student's token is a perfectly
 * valid JWT and must not reach here. `@RequiresFeature` is the finer one, and
 * it is per route rather than per class on purpose: reading the directory needs
 * READ, changing a student needs WRITE, and a class-level decorator would
 * collapse that distinction and make READ meaningless.
 */
@Controller('admin/students')
@Actors(ActorTypes.ADMIN)
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  /** Returns the list shape the response interceptor splits into data + meta. */
  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get()
  list(
    @Query(new ZodQuery(studentListQuerySchema)) query: StudentListQuery,
  ): Promise<Paginated<StudentSummary>> {
    return this.students.list(query);
  }

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get(':id')
  detail(@Param('id') id: string): Promise<StudentDetail> {
    return this.students.detail(id);
  }

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post()
  create(@Body(new ZodBody(createStudentSchema)) body: CreateStudentBody): Promise<StudentDetail> {
    return this.students.create(body);
  }

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodBody(updateStudentSchema)) body: UpdateStudentBody,
  ): Promise<StudentDetail> {
    return this.students.update(id, body);
  }

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Patch(':id/active')
  setActive(
    @Param('id') id: string,
    @Body(new ZodBody(setStudentActiveSchema)) body: SetStudentActiveBody,
  ): Promise<StudentDetail> {
    return this.students.setActive(id, body.isActive);
  }
}
