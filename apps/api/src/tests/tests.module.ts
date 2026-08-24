import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigsModule } from '../configs';
import { TestsController } from './tests.controller';
import { TestsService } from './tests.service';
import { PaperService } from './paper.service';
import { FinalizeService } from './finalize.service';

/** Owns `Test`. Its shape is the config's, read through `BaseConfigsService` rather than copied. */
@Module({
  imports: [PrismaModule, ConfigsModule],
  controllers: [TestsController],
  providers: [TestsService, PaperService, FinalizeService],
  exports: [TestsService, PaperService, FinalizeService],
})
export class TestsModule {}
