import { Controller, Get, Header, Headers, Res } from '@nestjs/common';
import { type Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { AppException, ErrorCodes } from '@iace/contracts';
import { AppConfigService } from '../../config/app-config.service';
import { Public } from '../security';
import { MetricsService } from './metrics.service';

const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

/** Live attempt counts and error rates are operational intelligence, so the scraper carries a token. */
@SkipThrottle()
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: AppConfigService,
  ) {}

  /** `@Res` because Prometheus parses line-oriented text, and the success envelope is not that. */
  @Public()
  @Get()
  @Header('Cache-Control', 'no-store')
  async scrape(
    @Res() response: Response,
    @Headers('authorization') authorization?: string,
  ): Promise<void> {
    this.assertScraper(authorization);

    response.setHeader('Content-Type', PROMETHEUS_CONTENT_TYPE);
    response.send(await this.metrics.scrape());
  }

  /** No token configured means development, where the schema has already refused this in production. */
  private assertScraper(authorization: string | undefined): void {
    const token = this.config.get('METRICS_TOKEN');
    if (!token) return;
    if (authorization !== `Bearer ${token}`) {
      throw new AppException(ErrorCodes.UNAUTHENTICATED, 'Not a scraper we know');
    }
  }
}
