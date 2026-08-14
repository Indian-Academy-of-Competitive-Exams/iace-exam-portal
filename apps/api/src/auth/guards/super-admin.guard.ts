import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ActorTypes, AppException, ErrorCodes } from '@iace/contracts';
import { SUPER_ADMIN_KEY } from '../../common/security';
import { type AuthenticatedUser } from '../../common/security';

/**
 * Super-admin-only routes.
 *
 * Deliberately NOT a page permission: a page can be granted, and the things
 * behind this guard are the ones every other admin's choices are made from —
 * the branch list first among them. Granting "groups.manage" must not become a
 * way to invent a new branch.
 *
 * Read routes stay on the page permission, because an admin who can create a
 * group has to be able to see the branches to pick one.
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
    return true;
  }
}
