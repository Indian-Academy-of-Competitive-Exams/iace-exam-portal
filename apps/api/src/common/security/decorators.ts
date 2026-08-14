import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import {
  AppException,
  ErrorCodes,
  type ActorType,
  type FeatureKey,
  type PermissionLevel,
} from '@iace/contracts';
import { type AuthenticatedUser } from './authenticated-user';

/**
 * The route-level access vocabulary, in the shared kernel rather than in the
 * auth module.
 *
 * These are pure metadata — `SetMetadata` and a reflector key, no auth logic —
 * and every controller in the API uses at least one of them. Leaving them under
 * `auth/` meant `branches`, `groups`, `students`, `imports`, `me` and `health`
 * all imported the auth MODULE to describe their own routes, which reads like
 * six dependencies on auth and is really six dependencies on a constant
 * (docs/03 §4, last bullet).
 *
 * The guards that ENFORCE them still live in `auth`, where they belong: they
 * verify tokens and read Redis sessions, which is auth's job and nobody else's.
 */

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
  key: FeatureKey;
  level: PermissionLevel;
}

/**
 * Require a feature permission at a level. Super admins bypass the check.
 *
 * The LEVEL is per route, not per controller, which is the point of having
 * levels at all: a class-level decorator would force reads and writes to need
 * the same grant and make READ meaningless. Put it on the handler — GET wants
 * READ, everything that changes something wants WRITE.
 */
export const RequiresFeature = (key: FeatureKey, level: PermissionLevel) =>
  SetMetadata(REQUIRED_FEATURE_KEY, { key, level } satisfies RequiredFeature);

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
