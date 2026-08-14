import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AuthModule } from '../auth';
import { PrismaModule } from '../prisma/prisma.module';
import { AppConfigModule } from '../config/config.module';
import { AppConfigService } from '../config/app-config.service';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  // AuthModule for `hashPin`: an imported student is given a starting PIN, and
  // it is hashed exactly the way a chosen one is — same argon2 settings, same
  // pepper — because auth is the only module that knows what those are.
  imports: [
    PrismaModule,
    AuthModule,
    /**
     * The upload ceiling, applied WHILE the body arrives.
     *
     * The controller also checks `file.size`, but that runs after multer has
     * buffered the whole upload into memory — too late to be a defence, since a
     * 500MB POST would already be allocated in full. Multipart never reaches
     * the body parsers in common/body-parsers.ts, so without this the importer
     * is the one authenticated endpoint with no ceiling at all.
     *
     * Same setting as those parsers, so there is one number, not two that drift.
     */
    MulterModule.registerAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        limits: { fileSize: config.importLimitBytes, files: 1 },
      }),
    }),
  ],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
