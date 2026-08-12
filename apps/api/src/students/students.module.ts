import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

@Module({
  // Identity documents are stored as keys; every read signs them.
  imports: [StorageModule],
  controllers: [StudentsController],
  providers: [StudentsService],
  exports: [StudentsService],
})
export class StudentsModule {}
