import { MulterModule } from '@nestjs/platform-express';
import { AppException, ErrorCodes } from '@iace/contracts';
import { AppConfigModule } from '../../config/config.module';
import { AppConfigService } from '../../config/app-config.service';

/** The upload ceiling, applied WHILE the body arrives, so an oversized sheet never reaches memory. */
export const uploadLimit = MulterModule.registerAsync({
  imports: [AppConfigModule],
  inject: [AppConfigService],
  useFactory: (config: AppConfigService) => ({
    limits: { fileSize: config.importLimitBytes, files: 1 },
  }),
});

/** The one field read off a multipart upload. */
export interface UploadedSheet {
  buffer: Buffer;
}

/** Multer has already refused anything over the ceiling, so a missing file is all that is left to say. */
export function requireFile(file: UploadedSheet | undefined): Buffer {
  if (!file) {
    throw new AppException(ErrorCodes.VALIDATION_ERROR, 'Choose a file to import', {
      fieldErrors: { file: ['Choose a file to import'] },
    });
  }
  return file.buffer;
}
