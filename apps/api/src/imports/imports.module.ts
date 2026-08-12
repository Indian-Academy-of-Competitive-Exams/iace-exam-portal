import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  // For PinService: an imported student is given a starting PIN, and it is
  // hashed exactly the way a chosen one is — same argon2 settings, same pepper.
  imports: [AuthModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
