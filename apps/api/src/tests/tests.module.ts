import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigsModule } from '../configs';
import { TestsController } from './tests.controller';
import { TestsService } from './tests.service';

/** Owns `Test`. Its shape is the config's, read through `BaseConfigsService` rather than copied. */
@Module({
  imports: [PrismaModule, ConfigsModule],
  controllers: [TestsController],
  providers: [TestsService],
  exports: [TestsService],
})
export class TestsModule {}
