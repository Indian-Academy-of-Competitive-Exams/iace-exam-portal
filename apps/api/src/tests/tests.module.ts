import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigsModule } from '../configs';
import { EventsModule } from '../common/events';
import { AssignmentsModule } from '../assignments';
import { QuestionsModule } from '../questions';
import { SeriesTestsController, TestsController, TypistDoneController } from './tests.controller';
import { TestsService } from './tests.service';
import { PaperService } from './paper.service';
import { FinalizeService } from './finalize.service';
import { OfferingService } from './offering.service';
import { API_ROLES, onRole } from '../config/api-role';

/** Owns `Test`. Its shape is the config's, read through `BaseConfigsService` rather than copied. */
@Module({
  imports: [PrismaModule, ConfigsModule, EventsModule, AssignmentsModule, QuestionsModule],
  controllers: onRole(
    [API_ROLES.CORE],
    [TestsController, SeriesTestsController, TypistDoneController],
  ),
  providers: [TestsService, PaperService, FinalizeService, OfferingService],
})
export class TestsModule {}
