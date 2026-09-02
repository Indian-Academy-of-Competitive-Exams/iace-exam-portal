import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ActorTypes,
  AppException,
  ErrorCodes,
  satisfiesLevel,
  type FeatureKey,
} from '@iace/contracts';
import {
  REQUIRED_FEATURE_KEY,
  type AuthenticatedUser,
  type RequiredFeature,
} from '../../common/security';

/** Feature-level admin permissions. */
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
    // Before the super-admin bypass, deliberately: deactivating an account has to remove access across
    // the whole platform, and a deactivated super admin who still bypassed every check would be the
    // one account the feature cannot switch off.
    if (!user.isActive) {
      throw new AppException(
        ErrorCodes.FORBIDDEN,
        'Your account has been deactivated — ask a super admin to restore it',
      );
    }
    if (user.isSuperAdmin) return true;

    const keys: readonly FeatureKey[] = Array.isArray(required.key)
      ? required.key
      : [required.key as FeatureKey];
    if (keys.some((key) => satisfiesLevel(user.permissions[key], required.level))) return true;

    throw new AppException(
      ErrorCodes.FORBIDDEN,
      `You do not have ${required.level} access to ${keys.join(' or ')}`,
    );
  }
}
