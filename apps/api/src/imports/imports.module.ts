import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AuthModule } from '../auth';
import { PrismaModule } from '../prisma/prisma.module';
import { AppConfigModule } from '../config/config.module';
import { AppConfigService } from '../config/app-config.service';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  // AuthModule for `hashPin`: an imported student is given a starting PIN, and it is hashed exactly
  // the way a chosen one is — same argon2 settings, same pepper — because auth is the only module
  // that knows what those are.
  imports: [
    PrismaModule,
    AuthModule,
    /** The upload ceiling, applied WHILE the body arrives. */
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
