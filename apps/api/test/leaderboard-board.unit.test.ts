import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { type ExecutionContext } from '@nestjs/common';
import {
  ActorTypes,
  AppException,
  ErrorCodes,
  LEADERBOARD_MEASURES,
  LEADERBOARD_MEASURE_BY_SCOPE,
  type LeaderboardRow,
} from '@iace/contracts';
import { ActorGuard } from '../src/auth/guards/actor.guard';
import { IS_PUBLIC_KEY, type AuthenticatedUser } from '../src/common/security';
import { MeLeaderboardController } from '../src/attempts/leaderboard.controller';
import { deltaOf, splitBoard } from '../src/attempts/leaderboard-board';

describe('deltaOf', () => {
  it('reads a climb as positive and a slide as negative', () => {
    assert.equal(deltaOf(14, 8), 6);
    assert.equal(deltaOf(4, 9), -5);
  });

  it('says nothing where there is no previous standing to move from', () => {
    assert.equal(deltaOf(null, 8), null);
  });
});

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

describe('a leaderboard across papers', () => {
  /** Marks belong to one paper. A board spanning papers can only honestly rank on percentile. */
  it('never ranks two papers on marks', () => {
    assert.equal(LEADERBOARD_MEASURE_BY_SCOPE.TEST, LEADERBOARD_MEASURES.MARKS);
    assert.equal(LEADERBOARD_MEASURE_BY_SCOPE.SERIES, LEADERBOARD_MEASURES.PERCENTILE_POINTS);
    assert.equal(LEADERBOARD_MEASURE_BY_SCOPE.ALL_TIME, LEADERBOARD_MEASURES.PERCENTILE_POINTS);
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
    value: 100 - rank,
    percentile: null,
    sittings: 1,
    deltaRank: null,
    isYou: false,
  };
}
