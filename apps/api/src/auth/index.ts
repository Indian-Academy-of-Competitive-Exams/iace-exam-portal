/** The auth module's public surface (docs/03 §4.1). */
export { AuthModule } from './auth.module';
export { AuthService } from './auth.service';
export { deviceFrom } from './device';
/** A starting PIN is random, hashed like any other, and readable exactly once — on its way out. */
export { StartingPinService, type StartingPin } from './pin/starting-pin.service';
export { type DeviceContext } from './auth.types';
