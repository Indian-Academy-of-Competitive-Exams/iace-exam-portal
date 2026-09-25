/** Rate limiting's public surface: the module to import, and the decorators a route reaches for. */
export { ThrottlingModule } from './throttling.module';
export { AuthRateLimit, SittingRateLimit, OtpRequestRateLimit } from './rate-limits';
