import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ADMIN_PAGES,
  ActorTypes,
  studentImportSchema,
  type StudentImportBody,
  type StudentImportPlan,
  type StudentImportResult,
} from '@iace/contracts';
import { Actors, RequiresPage } from '../auth/decorators';
import { ZodBody } from '../common/zod-validation.pipe';
import { ImportsService } from './imports.service';

/**
 * Mounted under /imports, which is the one path with the larger body limit —
 * see common/body-parsers.ts. Everything else on the API is capped far lower.
 */
@Controller('imports/students')
@Actors(ActorTypes.ADMIN)
@RequiresPage(ADMIN_PAGES.STUDENTS_MANAGE)
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  /** Writes nothing — this is what the admin reads before committing. */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  preview(
    @Body(new ZodBody(studentImportSchema)) body: StudentImportBody,
  ): Promise<StudentImportPlan> {
    return this.imports.previewStudents(body.csv);
  }

  @Post('commit')
  @HttpCode(HttpStatus.OK)
  commit(
    @Body(new ZodBody(studentImportSchema)) body: StudentImportBody,
  ): Promise<StudentImportResult> {
    return this.imports.commitStudents(body.csv);
  }
}
