import { Global, Module } from '@nestjs/common';
import { AppConfigService } from './app-config.service';

/** The env is loaded by `load-env.ts` at startup and checked here, in AppConfigService's own field initializer. */
@Global()
@Module({
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
