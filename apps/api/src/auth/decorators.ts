import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import { AppException, ErrorCodes, type ActorType } from '@iace/contracts';
import { type AuthenticatedUser } from './auth.types';

export const IS_PUBLIC_KEY = 'auth:public';
export const ACTORS_KEY = 'auth:actors';
export const REQUIRED_PAGE_KEY = 'auth:page';
export const SUPER_ADMIN_KEY = 'auth:superAdmin';

/** Opt a route out of the globally-applied JWT guard. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restrict a route to one identity table — students and admins are separate. */
export const Actors = (...actors: ActorType[]) => SetMetadata(ACTORS_KEY, actors);

/**
 * Require a page permission (a `Page.code`, e.g. "questions.manage").
 * Super admins bypass the check.
 */
export const RequiresPage = (pageCode: string) => SetMetadata(REQUIRED_PAGE_KEY, pageCode);

/**
 * Restrict a route to super admins, above and beyond any page permission.
 *
 * For the few things that define what everyone else may then choose from — the
 * branch list is the first — where a granted page permission is not enough.
 */
export const RequiresSuperAdmin = () => SetMetadata(SUPER_ADMIN_KEY, true);

/** Injects the authenticated user attached by JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!request.user) throw new AppException(ErrorCodes.UNAUTHENTICATED);
    return request.user;
  },
);
