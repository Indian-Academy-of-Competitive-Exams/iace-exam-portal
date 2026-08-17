import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ActorTypes, AppException, ErrorCodes } from '@iace/contracts';
import { SUPER_ADMIN_KEY, type AuthenticatedUser } from '../../common/security';

/**
 * Super-admin-only routes. Deliberately NOT a feature permission: these gate the list
 * every other admin's choices are made from, so granting one must not open them.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(SUPER_ADMIN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const { user } = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (user?.actor !== ActorTypes.ADMIN || !user.isSuperAdmin) {
      throw new AppException(ErrorCodes.FORBIDDEN, 'Only a super admin can change this');
    }
    // Being a super admin is not enough if the account is switched off — see
    // the same check in FeaturePermissionGuard.
    if (!user.isActive) {
      throw new AppException(
        ErrorCodes.FORBIDDEN,
        'Your account has been deactivated — ask a super admin to restore it',
      );
    }
    return true;
  }
}
