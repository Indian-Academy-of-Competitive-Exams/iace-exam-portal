import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { type Response } from 'express';
import {
  ActorTypes,
  AppException,
  ErrorCodes,
  FEATURE_KEYS,
  IMPORT_FILE_FIELD,
  PERMISSION_LEVELS,
  QUESTION_IMPORT_TEMPLATE_FILENAME,
  XLSX_CONTENT_TYPE,
  questionImportCommitSchema,
  type QuestionImportCommitBody,
  type QuestionImportPlan,
  type QuestionImportResult,
} from '@iace/contracts';
import { Actors, CurrentUser, RequiresFeature, type AuthenticatedUser } from '../common/security';
import { ZodBody } from '../common/zod-validation.pipe';
import { AppConfigService } from '../config/app-config.service';
import { QuestionImportService } from './question-import.service';

/** The two fields we use off a multipart upload. */
interface UploadedFileLike {
  buffer: Buffer;
  size: number;
}

/**
 * Mounted under /imports, the one prefix with the larger body limit — see
 * common/body-parsers.ts, which was written for exactly this endpoint.
 */
@Controller('imports/questions')
@Actors(ActorTypes.ADMIN)
export class QuestionImportController {
  constructor(
    private readonly imports: QuestionImportService,
    private readonly config: AppConfigService,
  ) {}

  @RequiresFeature(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get('template')
  @Header('Content-Type', XLSX_CONTENT_TYPE)
  @Header('Content-Disposition', `attachment; filename="${QUESTION_IMPORT_TEMPLATE_FILENAME}"`)
  // Never cached: it carries the taxonomy as it stands, and a stale copy offers
  // dropdowns of subjects that have since been renamed.
  @Header('Cache-Control', 'no-store')
  async template(@Res() response: Response): Promise<void> {
    response.send(await this.imports.template());
  }

  /** Writes no questions — this is what the admin reads before committing. */
  @RequiresFeature(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor(IMPORT_FILE_FIELD))
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: UploadedFileLike,
  ): Promise<QuestionImportPlan> {
    return this.imports.preview(this.bufferOf(file), user.id);
  }

  @RequiresFeature(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post('commit')
  @HttpCode(HttpStatus.OK)
  commit(
    @Body(new ZodBody(questionImportCommitSchema)) body: QuestionImportCommitBody,
  ): Promise<QuestionImportResult> {
    return this.imports.commit(body.importLogId);
  }

  /**
   * A second line of defence, and only that: MulterModule already aborts the
   * stream at the same limit (see questions.module.ts).
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
