import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException, type ActorType } from '@iace/contracts';
import { ACTORS_KEY } from '../decorators';
import { type AuthenticatedUser } from '../auth.types';

/**
 * Enforces @Actors(...). Students and Admins are separate tables with separate
 * rules, so an admin-only route must never accept a student token even though
 * both are perfectly valid JWTs.
 */
@Injectable()
export class ActorGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<ActorType[] | undefined>(ACTORS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!allowed || allowed.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!user || !allowed.includes(user.actor)) {
      throw new AppException('FORBIDDEN', 'This area is not available for your account type');
    }
    return true;
  }
}
