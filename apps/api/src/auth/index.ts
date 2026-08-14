/**
 * The auth module's public surface (docs/03 §4.1).
 *
 * Everything a sibling module may reach for, and nothing else. `PinService`,
 * `TokenService`, `SessionService`, `OtpService` and the guards are all
 * deliberately absent: they are how auth does its job, not what auth offers.
 * Needing one of them from outside means the thing you want is a method on
 * `AuthService` that hasn't been written yet.
 *
 * When auth eventually becomes its own service, this file is the list of calls
 * that turn into HTTP — which is exactly why it should stay short.
 */
export { AuthModule } from './auth.module';
export { AuthService } from './auth.service';
export { deviceFrom } from './device';
export { type DeviceContext } from './auth.types';
