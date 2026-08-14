import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
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
  GROUP_MEMBER_IMPORT_TEMPLATE_FILENAME,
  IMPORT_FILE_FIELD,
  STUDENT_IMPORT_TEMPLATE_FILENAME,
  XLSX_CONTENT_TYPE,
  type GroupMemberImportPlan,
  type GroupMemberImportResult,
  type StudentImportPlan,
  type StudentImportResult,
} from '@iace/contracts';
import { Actors, RequiresFeature } from '../common/security';
import { AppConfigService } from '../config/app-config.service';
import { ImportsService } from './imports.service';
import { buildGroupMemberTemplate, buildStudentTemplate } from './workbook';

/**
 * The two fields we use off a multipart upload.
 *
 * Declared rather than imported: @types/multer no longer augments the global
 * Express namespace, and depending on an ambient type from a transitive package
 * is how a dependency bump becomes a compile error in unrelated code.
 */
interface UploadedFileLike {
  buffer: Buffer;
  size: number;
}

/**
 * Mounted under /imports, which is the one path with the larger body limit —
 * see common/body-parsers.ts. Everything else on the API is capped far lower.
 */
@Controller('imports')
@Actors(ActorTypes.ADMIN)
export class ImportsController {
  constructor(
    private readonly imports: ImportsService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * The sample file. Generated on request from the same column list the parser
   * matches on, so it can never document a format the importer will not accept.
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

  /** Writes nothing — this is what the admin reads before committing. */
  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Post('students/preview')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor(IMPORT_FILE_FIELD))
  preview(@UploadedFile() file?: UploadedFileLike): Promise<StudentImportPlan> {
    return this.imports.previewStudents(this.bufferOf(file));
  }

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post('students/commit')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor(IMPORT_FILE_FIELD))
  commit(@UploadedFile() file?: UploadedFileLike): Promise<StudentImportResult> {
    return this.imports.commitStudents(this.bufferOf(file));
  }

  // ==========================================================================
  // Adding students to one group
  //
  // The group is in the PATH, not in the file: it is the screen the admin is
  // on, so it cannot be mistyped, and one sheet cannot scatter students across
  // batches nobody checked.
  // ==========================================================================

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get('groups/members/template')
  @Header('Content-Type', XLSX_CONTENT_TYPE)
  @Header('Content-Disposition', `attachment; filename="${GROUP_MEMBER_IMPORT_TEMPLATE_FILENAME}"`)
  @Header('Cache-Control', 'no-store')
  async groupMemberTemplate(@Res() response: Response): Promise<void> {
    response.send(await buildGroupMemberTemplate());
  }

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Post('groups/:groupId/members/preview')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor(IMPORT_FILE_FIELD))
  previewGroupMembers(
    @Param('groupId') groupId: string,
    @UploadedFile() file?: UploadedFileLike,
  ): Promise<GroupMemberImportPlan> {
    return this.imports.previewGroupMembers(groupId, this.bufferOf(file));
  }

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post('groups/:groupId/members/commit')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor(IMPORT_FILE_FIELD))
  commitGroupMembers(
    @Param('groupId') groupId: string,
    @UploadedFile() file?: UploadedFileLike,
  ): Promise<GroupMemberImportResult> {
    return this.imports.commitGroupMembers(groupId, this.bufferOf(file));
  }

  /**
   * A second line of defence, and only that: MulterModule already aborts the
   * stream at the same limit (see imports.module.ts), so reaching this means
   * something upstream let a large body through. Kept because the two are
   * enforced in different places and only one of them is ours to guarantee.
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
