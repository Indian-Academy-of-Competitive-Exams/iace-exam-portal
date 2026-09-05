import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AuthModule } from '../auth';
import { AuditModule } from '../audit';
import { AccessModule } from '../access';
import { EventsModule } from '../events';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { AppConfigModule } from '../config/config.module';
import { AppConfigService } from '../config/app-config.service';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  // AuthModule for the starting PIN, EventsModule for the roster, AccessModule for the program catalog.
  imports: [
    PrismaModule,
    AuthModule,
    StorageModule,
    AuditModule,
    EventsModule,
    AccessModule,
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
