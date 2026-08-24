import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigsModule } from '../configs';
import { TestsController } from './tests.controller';
import { TestsService } from './tests.service';
import { PaperService } from './paper.service';

/** Owns `Test`. Its shape is the config's, read through `BaseConfigsService` rather than copied. */
@Module({
  imports: [PrismaModule, ConfigsModule],
  controllers: [TestsController],
  providers: [TestsService, PaperService],
  exports: [TestsService, PaperService],
})
export class TestsModule {}
