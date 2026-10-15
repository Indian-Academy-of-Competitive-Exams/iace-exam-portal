import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException, ErrorCodes, type ActorType } from '@iace/contracts';
import { ACTORS_KEY, IS_PUBLIC_KEY, type AuthenticatedUser } from '../../common/security';

/** Enforces @Actors(...). Students and Admins are separate tables with separate rules, so an admin-only route must never accept a student token even though both are perfectly valid JWTs. */
@Injectable()
export class ActorGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, targets)) return true;
    const allowed = this.reflector.getAllAndOverride<ActorType[] | undefined>(ACTORS_KEY, targets);
    // Closed by default: a route that forgot @Actors refuses everyone rather than admitting a student to an admin screen.
    if (!allowed || allowed.length === 0) {
      throw new AppException(ErrorCodes.FORBIDDEN, 'This route names no account type');
    }

    const { user } = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!user || !allowed.includes(user.actor)) {
      throw new AppException(
        ErrorCodes.FORBIDDEN,
        'This area is not available for your account type',
      );
    }
    return true;
  }
}
