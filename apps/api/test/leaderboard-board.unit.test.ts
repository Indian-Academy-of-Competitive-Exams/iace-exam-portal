import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { type ExecutionContext } from '@nestjs/common';
import { ActorTypes, AppException, ErrorCodes, type LeaderboardRow } from '@iace/contracts';
import { ActorGuard } from '../src/auth/guards/actor.guard';
import { IS_PUBLIC_KEY, type AuthenticatedUser } from '../src/common/security';
import { MeLeaderboardController } from '../src/attempts/leaderboard.controller';
import { splitBoard } from '../src/attempts/leaderboard-board';

describe('splitBoard', () => {
  it('takes the top three as the podium and leaves the rest in order under it', () => {
    const rows = [seat(9), seat(1), seat(4), seat(2)];

    const { podium, neighbourhood } = splitBoard(rows);

    assert.deepEqual(
      podium.map((row) => row.rank),
      [1, 2],
    );
    assert.deepEqual(
      neighbourhood.map((row) => row.rank),
      [4, 9],
    );
  });
});

describe('reaching the leaderboard', () => {
  const reflector = new Reflector();

  /** Real names are on this payload. A @Public() here would put them on the open internet. */
  it('is not a public route', () => {
    const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      MeLeaderboardController.prototype.read,
      MeLeaderboardController,
    ]);

    assert.equal(isPublic, undefined);
  });

  it('refuses an admin token, valid though it is', () => {
    const guard = new ActorGuard(reflector);
    const request = {
      user: {
        id: 'adm_1',
        actor: ActorTypes.ADMIN,
        sessionId: 's',
        isSuperAdmin: false,
        isActive: true,
        permissions: {},
      } satisfies AuthenticatedUser,
    };
    const context = {
      getHandler: () => MeLeaderboardController.prototype.read,
      getClass: () => MeLeaderboardController,
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    assert.throws(
      () => guard.canActivate(context),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.FORBIDDEN,
    );
  });
});

function seat(rank: number): LeaderboardRow {
  return {
    rank,
    name: `Seat ${rank}`,
    branch: null,
    score: 100 - rank,
    percentile: null,
    isYou: false,
  };
}
