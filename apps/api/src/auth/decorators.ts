import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import { AppException, type ActorType } from '@iace/contracts';
import { type AuthenticatedUser } from './auth.types';

export const IS_PUBLIC_KEY = 'auth:public';
export const ACTORS_KEY = 'auth:actors';
export const REQUIRED_PAGE_KEY = 'auth:page';

/** Opt a route out of the globally-applied JWT guard. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restrict a route to one identity table — students and admins are separate. */
export const Actors = (...actors: ActorType[]) => SetMetadata(ACTORS_KEY, actors);

/**
 * Require a page permission (a `Page.code`, e.g. "questions.manage").
 * Super admins bypass the check.
 */
export const RequiresPage = (pageCode: string) => SetMetadata(REQUIRED_PAGE_KEY, pageCode);

/** Injects the authenticated user attached by JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!request.user) throw new AppException('UNAUTHENTICATED');
    return request.user;
  },
);
