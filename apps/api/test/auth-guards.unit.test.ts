import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { type ExecutionContext } from '@nestjs/common';
import {
  ActorTypes,
  AppException,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  type AdminPermissions,
} from '@iace/contracts';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { ActorGuard } from '../src/auth/guards/actor.guard';
import { FeaturePermissionGuard } from '../src/auth/guards/feature-permission.guard';
import { Actors, Public, RequiresFeature, type AuthenticatedUser } from '../src/common/security';
import { SessionService } from '../src/auth/session.service';
import { TokenService } from '../src/auth/token.service';
import { FakeConfig, FakeRedis, NO_DEVICE } from './support/fakes';

/** The authorisation boundary. */

/** Stands in for a controller, so the decorators under test are really applied. */
class ProbeController {
  @Public()
  publicRoute() {}

  @Actors(ActorTypes.ADMIN)
  adminOnly() {}

  @Actors(ActorTypes.STUDENT)
  studentOnly() {}

  @RequiresFeature(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  managesQuestions() {}

  @RequiresFeature(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.READ)
  readsQuestions() {}

  plainRoute() {}
}

@Actors(ActorTypes.ADMIN)
class AdminOnlyController {
  anyRoute() {}
}

type Handler = () => void;

function contextFor(
  handler: Handler,
  cls: object,
  request: Record<string, unknown> = {},
): { context: ExecutionContext; request: Record<string, unknown> } {
  const context = {
    getHandler: () => handler,
    getClass: () => cls,
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
  };
  return { context: context as unknown as ExecutionContext, request };
}

const probe = (handler: Handler, request?: Record<string, unknown>) =>
  contextFor(handler, ProbeController, request);

// ---------------------------------------------------------------------------

describe('JwtAuthGuard', () => {
  const SUBJECT = 'stu_1';

  function build() {
    const redis = new FakeRedis();
    const config = new FakeConfig();
    const tokens = new TokenService(new JwtService({}), config.asService());
    const sessions = new SessionService(redis.asService());
    const guard = new JwtAuthGuard(new Reflector(), tokens, sessions);
    return { guard, tokens, sessions, redis };
  }

  /** Signs in for real: a session in Redis plus the matching access token. */
  async function signIn(
    ctx: ReturnType<typeof build>,
    claims: {
      sub?: string;
      actor?: 'STUDENT' | 'ADMIN';
      isSuperAdmin?: boolean;
      permissions?: AdminPermissions;
      allBranches?: boolean;
      branchIds?: string[];
    } = {},
  ) {
    const sub = claims.sub ?? SUBJECT;
    const actor = claims.actor ?? ActorTypes.STUDENT;
    const sid = ctx.sessions.newSessionId();
    await ctx.sessions.create(actor, sub, sid, 'refresh-token', NO_DEVICE, 3600);
    const token = await ctx.tokens.signAccess({
      sub,
      actor,
      sid,
      ...(claims.isSuperAdmin === undefined ? {} : { isSuperAdmin: claims.isSuperAdmin }),
      ...(claims.permissions === undefined ? {} : { permissions: claims.permissions }),
      ...(claims.allBranches === undefined ? {} : { allBranches: claims.allBranches }),
      ...(claims.branchIds === undefined ? {} : { branchIds: claims.branchIds }),
    });
    return { token, sid, sub, actor };
  }

  const authed = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

  it('lets a @Public route through with no token at all', async () => {
    const { guard } = build();

    const { context } = probe(ProbeController.prototype.publicRoute, { headers: {} });

    assert.equal(await guard.canActivate(context), true);
  });

  it('refuses a protected route with no Authorization header', async () => {
    const { guard } = build();
    const { context } = probe(ProbeController.prototype.plainRoute, { headers: {} });

    await assert.rejects(
      () => guard.canActivate(context),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, 'UNAUTHENTICATED');
        assert.equal(error.message, 'Missing access token');
        return true;
      },
    );
  });

  it('refuses a header that is not a bearer token', async () => {
    const { guard } = build();

    for (const authorization of ['', 'Bearer', 'Basic abc123', 'Bearer ', 'token-without-scheme']) {
      const { context } = probe(ProbeController.prototype.plainRoute, {
        headers: { authorization },
      });
      await assert.rejects(
        () => guard.canActivate(context),
        (e: unknown) => AppException.is(e) && e.code === 'UNAUTHENTICATED',
        `expected ${JSON.stringify(authorization)} to be refused`,
      );
    }
  });

  it('accepts a valid token backed by a live session, and attaches the user', async () => {
    const ctx = build();
    const { token, sid, sub } = await signIn(ctx);
    const { context, request } = probe(ProbeController.prototype.plainRoute, authed(token));

    assert.equal(await ctx.guard.canActivate(context), true);

    assert.deepEqual(request.user, {
      id: sub,
      actor: ActorTypes.STUDENT,
      sessionId: sid,
      isSuperAdmin: false,
      isActive: true,
      permissions: {},
    } satisfies AuthenticatedUser);
  });

  it('refuses a perfectly valid token once the session is revoked', async () => {
    const ctx = build();
    const { token, sid, sub } = await signIn(ctx);
    await ctx.sessions.revoke(ActorTypes.STUDENT, sub, sid);

    // The JWT has NOT expired.
    const { context } = probe(ProbeController.prototype.plainRoute, authed(token));

    await assert.rejects(
      () => ctx.guard.canActivate(context),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.message, 'Session has ended — sign in again');
        return true;
      },
    );
  });

  it('refuses a token whose session expired on its own', async () => {
    const ctx = build();
    const { token } = await signIn(ctx);
    ctx.redis.advanceSeconds(3601);

    const { context } = probe(ProbeController.prototype.plainRoute, authed(token));

    await assert.rejects(
      () => ctx.guard.canActivate(context),
      (e: unknown) => AppException.is(e) && e.code === 'UNAUTHENTICATED',
    );
  });

  it('refuses a refresh token presented as an access token', async () => {
    const ctx = build();
    const refresh = await ctx.tokens.signRefresh({
      sub: SUBJECT,
      actor: ActorTypes.STUDENT,
      sid: 'sess',
    });
    const { context } = probe(ProbeController.prototype.plainRoute, authed(refresh));

    await assert.rejects(
      () => ctx.guard.canActivate(context),
      (e: unknown) => AppException.is(e) && e.code === 'UNAUTHENTICATED',
    );
  });

  it('carries an admin authority through to the request', async () => {
    const ctx = build();
    const { token } = await signIn(ctx, {
      sub: 'adm_1',
      actor: ActorTypes.ADMIN,
      isSuperAdmin: true,
      permissions: { [FEATURE_KEYS.QUESTION_MANAGEMENT]: PERMISSION_LEVELS.WRITE },
    });
    const { context, request } = probe(ProbeController.prototype.plainRoute, authed(token));

    await ctx.guard.canActivate(context);

    const user = request.user as AuthenticatedUser;
    assert.equal(user.actor, ActorTypes.ADMIN);
    assert.equal(user.isSuperAdmin, true);
    assert.deepEqual(user.permissions, {
      [FEATURE_KEYS.QUESTION_MANAGEMENT]: PERMISSION_LEVELS.WRITE,
    });
  });

  it('does not look up a session for a @Public route', async () => {
    // Public routes must work before anyone has a session at all — signup would
    // be unreachable otherwise.
    const { guard } = build();
    const { context } = probe(ProbeController.prototype.publicRoute, {
      headers: { authorization: 'Bearer total-nonsense' },
    });

    assert.equal(await guard.canActivate(context), true);
  });
});

// ---------------------------------------------------------------------------

describe('ActorGuard', () => {
  const guard = new ActorGuard(new Reflector());
  const user = (actor: 'STUDENT' | 'ADMIN'): { user: AuthenticatedUser } => ({
    user: {
      id: 'x',
      actor,
      sessionId: 's',
      isSuperAdmin: false,
      isActive: true,
      permissions: {},
    },
  });

  it('allows a route that names no actor', async () => {
    const { context } = probe(ProbeController.prototype.plainRoute, user(ActorTypes.STUDENT));

    assert.equal(await guard.canActivate(context), true);
  });

  it('allows the actor the route names', async () => {
    const { context } = probe(ProbeController.prototype.adminOnly, user(ActorTypes.ADMIN));

    assert.equal(await guard.canActivate(context), true);
  });

  it('refuses a student token on an admin route, valid though the token is', async () => {
    // Students and admins are separate tables with separate rules. Both hold perfectly good JWTs; this
    // is the only thing keeping one out of the other's routes.
    const { context } = probe(ProbeController.prototype.adminOnly, user(ActorTypes.STUDENT));

    assert.throws(
      () => guard.canActivate(context),
      (e: unknown) => AppException.is(e) && e.code === 'FORBIDDEN',
    );
  });

  it('refuses an admin token on a student route', async () => {
    const { context } = probe(ProbeController.prototype.studentOnly, user(ActorTypes.ADMIN));

    assert.throws(
      () => guard.canActivate(context),
      (e: unknown) => AppException.is(e) && e.code === 'FORBIDDEN',
    );
  });

  it('refuses when no user was attached', async () => {
    const { context } = probe(ProbeController.prototype.adminOnly, {});

    assert.throws(
      () => guard.canActivate(context),
      (e: unknown) => AppException.is(e) && e.code === 'FORBIDDEN',
    );
  });

  it('honours @Actors declared on the CONTROLLER, not just the handler', async () => {
    // Otherwise a class-level restriction would be silently decorative, and
    // every method on an admin controller would be open to students.
    const { context } = contextFor(
      AdminOnlyController.prototype.anyRoute,
      AdminOnlyController,
      user(ActorTypes.STUDENT),
    );

    assert.throws(
      () => guard.canActivate(context),
      (e: unknown) => AppException.is(e) && e.code === 'FORBIDDEN',
    );
  });
});

// ---------------------------------------------------------------------------

describe('FeaturePermissionGuard', () => {
  const guard = new FeaturePermissionGuard(new Reflector());
  const admin = (
    permissions: AdminPermissions,
    isSuperAdmin = false,
    isActive = true,
  ): { user: AuthenticatedUser } => ({
    user: {
      id: 'adm',
      actor: ActorTypes.ADMIN,
      sessionId: 's',
      isSuperAdmin,
      isActive,
      permissions,
    },
  });

  it('allows a route that requires no feature', async () => {
    const { context } = probe(ProbeController.prototype.plainRoute, admin({}));

    assert.equal(await guard.canActivate(context), true);
  });

  it('allows an admin holding the exact level', async () => {
    const { context } = probe(
      ProbeController.prototype.managesQuestions,
      admin({ [FEATURE_KEYS.QUESTION_MANAGEMENT]: PERMISSION_LEVELS.WRITE }),
    );

    assert.equal(await guard.canActivate(context), true);
  });

  it('refuses READ where the route wants WRITE', async () => {
    // The failure the levels exist to prevent: a viewer must not be able to
    // change anything just because they can see it.
    const { context } = probe(
      ProbeController.prototype.managesQuestions,
      admin({ [FEATURE_KEYS.QUESTION_MANAGEMENT]: PERMISSION_LEVELS.READ }),
    );

    assert.throws(
      () => guard.canActivate(context),
      (error: unknown) => AppException.is(error) && error.code === 'FORBIDDEN',
    );
  });

  it('lets WRITE satisfy a route that only wants READ', async () => {
    const { context } = probe(
      ProbeController.prototype.readsQuestions,
      admin({ [FEATURE_KEYS.QUESTION_MANAGEMENT]: PERMISSION_LEVELS.WRITE }),
    );

    assert.equal(await guard.canActivate(context), true);
  });

  it('refuses an admin granted a different feature, and names what was needed', async () => {
    const { context } = probe(
      ProbeController.prototype.managesQuestions,
      admin({ [FEATURE_KEYS.STUDENT_MANAGEMENT]: PERMISSION_LEVELS.WRITE }),
    );

    assert.throws(
      () => guard.canActivate(context),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, 'FORBIDDEN');
        assert.match(error.message, /QUESTION_MANAGEMENT/);
        return true;
      },
    );
  });

  it('lets a super admin through without the grant', async () => {
    // How the hand-inserted bootstrap account reaches every screen before any grants exist. If this
    // stopped working, a fresh deployment would be unusable and there is no seed to fall back on.
    const { context } = probe(ProbeController.prototype.managesQuestions, admin({}, true));

    assert.equal(await guard.canActivate(context), true);
  });

  it('refuses a deactivated admin, even one who is a super admin', async () => {
    // THE guarantee this change exists for.
    const { context } = probe(ProbeController.prototype.managesQuestions, admin({}, true, false));

    assert.throws(
      () => guard.canActivate(context),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, 'FORBIDDEN');
        assert.match(error.message, /deactivated/i);
        return true;
      },
    );
  });

  it('refuses a deactivated admin who still holds a matching grant', async () => {
    // Grants are pruned on deactivation, but the refusal must not depend on
    // that cleanup having succeeded.
    const { context } = probe(
      ProbeController.prototype.managesQuestions,
      admin({ [FEATURE_KEYS.QUESTION_MANAGEMENT]: PERMISSION_LEVELS.WRITE }, false, false),
    );

    assert.throws(
      () => guard.canActivate(context),
      (error: unknown) => AppException.is(error) && error.code === 'FORBIDDEN',
    );
  });

  it('refuses a student outright, whatever the token claims', async () => {
    const { context } = probe(ProbeController.prototype.managesQuestions, {
      user: {
        id: 'stu',
        actor: ActorTypes.STUDENT,
        sessionId: 's',
        isSuperAdmin: true,
        isActive: true,
        permissions: { [FEATURE_KEYS.QUESTION_MANAGEMENT]: PERMISSION_LEVELS.WRITE },
      } satisfies AuthenticatedUser,
    });

    assert.throws(
      () => guard.canActivate(context),
      (e: unknown) => AppException.is(e) && e.code === 'FORBIDDEN',
    );
  });

  it('refuses when no user was attached', async () => {
    const { context } = probe(ProbeController.prototype.managesQuestions, {});

    assert.throws(
      () => guard.canActivate(context),
      (e: unknown) => AppException.is(e) && e.code === 'FORBIDDEN',
    );
  });
});
