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
  AppException,
  ErrorCodes,
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
import {
  Actors,
  branchScopeOf,
  CurrentUser,
  RequiresFeature,
  RequiresSuperAdmin,
  type AuthenticatedUser,
} from '../common/security';
import { AppConfigService } from '../config/app-config.service';
import { ImportsService } from './imports.service';
import { buildCandidateTemplate, buildProgramTemplate, buildStudentTemplate } from './workbook';

/** The two fields we use off a multipart upload. */
interface UploadedFileLike {
  buffer: Buffer;
  size: number;
}

/**
 * Mounted under /imports, which is the one path with the larger body limit — see
 * common/body-parsers.ts. Everything else on the API is capped far lower.
 */
@Controller('imports')
@Actors(ActorTypes.ADMIN)
export class ImportsController {
  constructor(
    private readonly imports: ImportsService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * The sample file. Generated on request from the same column list the parser matches on, so it can
   * never document a format the importer will not accept.
   */
  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get('students/template')
  @Header('Content-Type', XLSX_CONTENT_TYPE)
  @Header('Content-Disposition', `attachment; filename="${STUDENT_IMPORT_TEMPLATE_FILENAME}"`)
  // Not cached: it is generated from code that changes with the format, and a
  // stale copy in a proxy is a sample that quietly documents last month's rules.
  @Header('Cache-Control', 'no-store')
  async template(@Res() response: Response): Promise<void> {
    response.send(await buildStudentTemplate());
  }

  /** Writes no students — this is what the admin reads before committing. */
  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Post('students/preview')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor(IMPORT_FILE_FIELD))
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: UploadedFileLike,
  ): Promise<StudentImportPlan> {
    return this.imports.previewStudents(this.bufferOf(file), branchScopeOf(user));
  }

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post('students/commit')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor(IMPORT_FILE_FIELD))
  commit(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: UploadedFileLike,
  ): Promise<StudentImportResult> {
    return this.imports.commitStudents(this.bufferOf(file), user.id, branchScopeOf(user));
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
    @CurrentUser() user: AuthenticatedUser,
    @Param('code') code: string,
    @UploadedFile() file?: UploadedFileLike,
  ): Promise<ProgramImportPlan> {
    return this.imports.previewProgramStudents(code, this.bufferOf(file), branchScopeOf(user));
  }

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post('programs/:code/students/commit')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor(IMPORT_FILE_FIELD))
  commitProgramStudents(
    @CurrentUser() user: AuthenticatedUser,
    @Param('code') code: string,
    @UploadedFile() file?: UploadedFileLike,
  ): Promise<ProgramImportResult> {
    return this.imports.commitProgramStudents(
      code,
      this.bufferOf(file),
      user.id,
      branchScopeOf(user),
    );
  }

  /** On EVENT: the account it mints is NON_IACE and reaches that event and nothing else. */
  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Post('events/:eventId/candidates/preview')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor(IMPORT_FILE_FIELD))
  previewEventCandidates(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId') eventId: string,
    @UploadedFile() file?: UploadedFileLike,
  ): Promise<CandidateImportPlan> {
    return this.imports.previewEventCandidates(eventId, this.bufferOf(file), branchScopeOf(user));
  }

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post('events/:eventId/candidates/commit')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor(IMPORT_FILE_FIELD))
  commitEventCandidates(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId') eventId: string,
    @UploadedFile() file?: UploadedFileLike,
  ): Promise<CandidateImportResult> {
    return this.imports.commitEventCandidates(
      eventId,
      this.bufferOf(file),
      user.id,
      branchScopeOf(user),
    );
  }

  /** Super admin, as the old fire-and-forget trigger was: it pulls a whole roster from elsewhere. */
  @RequiresSuperAdmin()
  @Post('students/portal/preview')
  @HttpCode(HttpStatus.OK)
  previewPortal(): Promise<StudentImportPlan> {
    return this.imports.previewPortalStudents();
  }

  @RequiresSuperAdmin()
  @Post('students/portal/commit')
  @HttpCode(HttpStatus.OK)
  commitPortal(@CurrentUser() user: AuthenticatedUser): Promise<StudentImportResult> {
    return this.imports.commitPortalStudents(user.id);
  }

  /**
   * A second line of defence, and only that: MulterModule already aborts the stream at the same
   * limit (see imports.module.ts), so reaching this means something upstream let a large body
   * through.
   */
  private bufferOf(file: UploadedFileLike | undefined): Buffer {
    if (!file) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'Choose a file to import', {
        fieldErrors: { file: ['Choose a file to import'] },
      });
    }

    const limit = this.config.importLimitBytes;
    if (file.size > limit) {
      throw new AppException(
        ErrorCodes.VALIDATION_ERROR,
        `That file is larger than ${Math.round(limit / 1024 / 1024)}MB. Split it and import in parts.`,
        { fieldErrors: { file: ['That file is too large'] } },
      );
    }

    return file.buffer;
  }
}
