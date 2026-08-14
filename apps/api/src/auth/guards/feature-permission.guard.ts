import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ActorTypes, AppException, ErrorCodes, satisfiesLevel } from '@iace/contracts';
import {
  REQUIRED_FEATURE_KEY,
  type AuthenticatedUser,
  type RequiredFeature,
} from '../../common/security';

/**
 * Feature-level admin permissions. A route declares the feature and level it
 * needs; the super admin bypasses the check entirely, which is how the
 * hand-inserted bootstrap account (see the README) reaches everything before
 * any grants exist.
 *
 * The grants ride in the access token, so this costs nothing at request time; a
 * permission change takes effect on the next refresh (<= the access TTL). That
 * lag is deliberate — the alternative is a database read on every request to
 * every endpoint, to catch a change that happens a few times a month.
 *
 * `satisfiesLevel` is imported rather than reimplemented. The admin app asks
 * the same question to decide whether to render a button, and the two answering
 * differently is precisely the bug where a visible control is refused by the
 * server.
 */
@Injectable()
export class FeaturePermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RequiredFeature | undefined>(
      REQUIRED_FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const { user } = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (user?.actor !== ActorTypes.ADMIN) {
      throw new AppException(ErrorCodes.FORBIDDEN, 'Admin access required');
    }
    // Before the super-admin bypass, deliberately: deactivating an account has
    // to remove access across the whole platform, and a deactivated super
    // admin who still bypassed every check would be the one account the
    // feature cannot switch off.
    if (!user.isActive) {
      throw new AppException(
        ErrorCodes.FORBIDDEN,
        'Your account has been deactivated — ask a super admin to restore it',
      );
    }
    if (user.isSuperAdmin) return true;

    const granted = user.permissions[required.key];
    if (!satisfiesLevel(granted, required.level)) {
      throw new AppException(
        ErrorCodes.FORBIDDEN,
        `You do not have ${required.level} access to ${required.key}`,
      );
    }
    return true;
  }
}
