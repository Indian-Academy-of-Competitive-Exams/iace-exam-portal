/** Rate limiting's public surface: the module to import, and the two decorators a route reaches for. */
export { ThrottlingModule } from './throttling.module';
export { AuthRateLimit, ShareRateLimit, SittingRateLimit } from './rate-limits';
export { trackerFor, windowRecord, ALLOWED } from './rate-limit';
