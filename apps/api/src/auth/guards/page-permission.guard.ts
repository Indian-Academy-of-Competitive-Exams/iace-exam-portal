import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ActorTypes, AppException, ErrorCodes } from '@iace/contracts';
import { REQUIRED_PAGE_KEY } from '../../common/security';
import { type AuthenticatedUser } from '../../common/security';

/**
 * Page-level admin permissions. Each admin screen declares the `Page.code` it
 * needs; the super admin bypasses the check entirely, which is how the seeded
 * bootstrap account can reach everything before any grants exist.
 *
 * Codes are carried in the access token, so this costs nothing at request time;
 * a permission change takes effect on the next refresh (≤ the access TTL).
 */
@Injectable()
export class PagePermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPage = this.reflector.getAllAndOverride<string | undefined>(REQUIRED_PAGE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredPage) return true;

    const { user } = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (user?.actor !== ActorTypes.ADMIN) {
      throw new AppException(ErrorCodes.FORBIDDEN, 'Admin access required');
    }
    if (user.isSuperAdmin) return true;

    if (!user.pages.includes(requiredPage)) {
      throw new AppException(ErrorCodes.FORBIDDEN, `You do not have access to "${requiredPage}"`);
    }
    return true;
  }
}
