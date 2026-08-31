import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigsModule } from '../configs';
import { AttemptsModule } from '../attempts';
import { EventsModule } from '../common/events';
import { BranchTestsController, SeriesTestsController, TestsController } from './tests.controller';
import { TestsService } from './tests.service';
import { PaperService } from './paper.service';
import { FinalizeService } from './finalize.service';
import { OfferingService } from './offering.service';

/** Owns `Test`. Its shape is the config's, read through `BaseConfigsService` rather than copied. */
@Module({
  imports: [PrismaModule, ConfigsModule, EventsModule, AttemptsModule],
  controllers: [TestsController, SeriesTestsController, BranchTestsController],
  providers: [TestsService, PaperService, FinalizeService, OfferingService],
  exports: [TestsService, PaperService, FinalizeService, OfferingService],
})
export class TestsModule {}
