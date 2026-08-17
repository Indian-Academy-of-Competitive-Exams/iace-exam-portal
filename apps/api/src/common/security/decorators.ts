import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import { AppException, ErrorCodes, type ActorType, type PermissionLevel } from '@iace/contracts';
import { type AuthenticatedUser } from './authenticated-user';

/** The route-level access vocabulary, in the shared kernel rather than in the auth module. */

export const IS_PUBLIC_KEY = 'auth:public';
export const ACTORS_KEY = 'auth:actors';
export const REQUIRED_FEATURE_KEY = 'auth:feature';
export const SUPER_ADMIN_KEY = 'auth:superAdmin';

/** Opt a route out of the globally-applied JWT guard. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restrict a route to one identity table — students and admins are separate. */
export const Actors = (...actors: ActorType[]) => SetMetadata(ACTORS_KEY, actors);

/** What a route demands: a feature, at a level. */
export interface RequiredFeature {
  key: string;
  level: PermissionLevel;
}

/** Require a feature permission at a level. Super admins bypass the check. */
export const RequiresFeature = (key: string, level: PermissionLevel) =>
  SetMetadata(REQUIRED_FEATURE_KEY, { key, level } satisfies RequiredFeature);

/** Restrict a route to super admins, above and beyond any page permission. */
export const RequiresSuperAdmin = () => SetMetadata(SUPER_ADMIN_KEY, true);

/** Injects the authenticated user attached by JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!request.user) throw new AppException(ErrorCodes.UNAUTHENTICATED);
    return request.user;
  },
);
