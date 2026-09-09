/**
 * A test's cohort report. It lives here rather than in the tests module because everything it
 * reads is an attempt rollup, and it pays with TEST_MANAGEMENT READ — the same key that opens the
 * test itself, so an admin who may see the paper may see how the paper went.
 */
import { Controller, Get, Param } from '@nestjs/common';
import { ActorTypes, FEATURE_KEYS, PERMISSION_LEVELS, type TestAnalytics } from '@iace/contracts';
import { Actors, RequiresFeature } from '../common/security';
import { TestAnalyticsService } from './test-analytics.service';

@Controller('admin/tests')
@Actors(ActorTypes.ADMIN)
export class AdminTestAnalyticsController {
  constructor(private readonly analytics: TestAnalyticsService) {}

  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get(':id/analytics')
  forTest(@Param('id') testId: string): Promise<TestAnalytics> {
    return this.analytics.forTest(testId);
  }
}
