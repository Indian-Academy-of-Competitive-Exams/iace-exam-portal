import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StudentsModule } from '../students/students.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  // StudentsModule for the read/update path — the flags it recomputes are the
  // reason this does not have its own. AuthModule for the PIN and sessions.
  imports: [AuthModule, StudentsModule],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
