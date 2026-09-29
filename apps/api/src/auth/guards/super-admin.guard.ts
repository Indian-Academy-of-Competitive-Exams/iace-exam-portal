import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ActorTypes, AppException, ErrorCodes } from '@iace/contracts';
import { SUPER_ADMIN_KEY, type AuthenticatedUser } from '../../common/security';

/** Super-admin-only routes. Deliberately NOT a feature permission: these gate the list every other admin's choices are made from, so granting one must not open them. */
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
    // Switched off first: a deactivated admin's identity carries no bypass, so this is where they learn why.
    if (user?.actor === ActorTypes.ADMIN && !user.isActive) {
      throw new AppException(
        ErrorCodes.FORBIDDEN,
        'Your account has been deactivated. Ask a super admin to restore it',
      );
    }
    if (user?.actor !== ActorTypes.ADMIN || !user.isSuperAdmin) {
      throw new AppException(ErrorCodes.FORBIDDEN, 'Only a super admin can change this');
    }
    return true;
  }
}
