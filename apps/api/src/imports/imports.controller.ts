import {
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  HttpStatus,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { type Response } from 'express';
import {
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  ActorTypes,
  CANDIDATE_IMPORT_TEMPLATE_FILENAME,
  IMPORT_FILE_FIELD,
  PROGRAM_IMPORT_TEMPLATE_FILENAME,
  STUDENT_IMPORT_TEMPLATE_FILENAME,
  XLSX_CONTENT_TYPE,
  type CandidateImportPlan,
  type CandidateImportResult,
  type ProgramImportPlan,
  type ProgramImportResult,
  type StudentImportPlan,
  type StudentImportResult,
} from '@iace/contracts';
import { Actors, CurrentUser, RequiresFeature, type AuthenticatedUser } from '../common/security';
import { requireFile, type UploadedSheet } from '../common/importing/upload';
import { ImportsService } from './imports.service';
import { buildCandidateTemplate, buildProgramTemplate, buildStudentTemplate } from './workbook';

@Controller('imports')
@Actors(ActorTypes.ADMIN)
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  /** The sample file. Generated on request from the same column list the parser matches on, so it can never document a format the importer will not accept. */
  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get('students/template')
  @Header('Content-Type', XLSX_CONTENT_TYPE)
  @Header('Content-Disposition', `attachment; filename="${STUDENT_IMPORT_TEMPLATE_FILENAME}"`)
  // Not cached: it is generated from code that changes with the format, and a stale copy in a proxy is a sample that quietly documents last month's rules.
  @Header('Cache-Control', 'no-store')
  async template(@Res() response: Response): Promise<void> {
    response.send(await buildStudentTemplate());
  }

  /** Writes no students — this is what the admin reads before committing. */
  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Post('students/preview')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor(IMPORT_FILE_FIELD))
  preview(@UploadedFile() file?: UploadedSheet): Promise<StudentImportPlan> {
    return this.imports.previewStudents(requireFile(file));
  }

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post('students/commit')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor(IMPORT_FILE_FIELD))
  commit(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: UploadedSheet,
  ): Promise<StudentImportResult> {
    return this.imports.commitStudents(requireFile(file), user.id);
  }

  /** The candidate sample, generated from the same two columns the parser matches on. */
  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get('events/candidates/template')
  @Header('Content-Type', XLSX_CONTENT_TYPE)
  @Header('Content-Disposition', `attachment; filename="${CANDIDATE_IMPORT_TEMPLATE_FILENAME}"`)
  @Header('Cache-Control', 'no-store')
  async candidateTemplate(@Res() response: Response): Promise<void> {
    response.send(await buildCandidateTemplate());
  }

  /** The program enrolment sample, generated from the same two columns the parser matches on. */
  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get('programs/students/template')
  @Header('Content-Type', XLSX_CONTENT_TYPE)
  @Header('Content-Disposition', `attachment; filename="${PROGRAM_IMPORT_TEMPLATE_FILENAME}"`)
  @Header('Cache-Control', 'no-store')
  async programTemplate(@Res() response: Response): Promise<void> {
    response.send(await buildProgramTemplate());
  }

  /** On PROGRAM: it adds a code to students who already exist, and creates none of them. */
  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Post('programs/:code/students/preview')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor(IMPORT_FILE_FIELD))
  previewProgramStudents(
    @Param('code') code: string,
    @UploadedFile() file?: UploadedSheet,
  ): Promise<ProgramImportPlan> {
    return this.imports.previewProgramStudents(code, requireFile(file));
  }

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post('programs/:code/students/commit')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor(IMPORT_FILE_FIELD))
  commitProgramStudents(
    @CurrentUser() user: AuthenticatedUser,
    @Param('code') code: string,
    @UploadedFile() file?: UploadedSheet,
  ): Promise<ProgramImportResult> {
    return this.imports.commitProgramStudents(code, requireFile(file), user.id);
  }

  /** On EVENT: the account it mints is NON_IACE and reaches that event and nothing else. */
  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Post('events/:eventId/candidates/preview')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor(IMPORT_FILE_FIELD))
  previewEventCandidates(
    @Param('eventId') eventId: string,
    @UploadedFile() file?: UploadedSheet,
  ): Promise<CandidateImportPlan> {
    return this.imports.previewEventCandidates(eventId, requireFile(file));
  }

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post('events/:eventId/candidates/commit')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor(IMPORT_FILE_FIELD))
  commitEventCandidates(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId') eventId: string,
    @UploadedFile() file?: UploadedSheet,
  ): Promise<CandidateImportResult> {
    return this.imports.commitEventCandidates(eventId, requireFile(file), user.id);
  }
}
