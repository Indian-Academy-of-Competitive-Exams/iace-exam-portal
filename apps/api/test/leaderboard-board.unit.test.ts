import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { type ExecutionContext } from '@nestjs/common';
import { ActorTypes, AppException, ErrorCodes, type LeaderboardRow } from '@iace/contracts';
import { ActorGuard } from '../src/auth/guards/actor.guard';
import { IS_PUBLIC_KEY, type AuthenticatedUser } from '../src/common/security';
import { MeLeaderboardController } from '../src/attempts/leaderboard.controller';
import { pageRanks, splitBoard } from '../src/attempts/leaderboard-board';

describe('splitBoard', () => {
  it('takes the top three as the podium and the page in order under it', () => {
    const rows = [seat(9), seat(1), seat(4), seat(2)];

    const { podium, rows: page } = splitBoard(rows, pageRanks(1, 20));

    assert.deepEqual(
      podium.map((row) => row.rank),
      [1, 2],
    );
    assert.deepEqual(
      page.map((row) => row.rank),
      [4, 9],
    );
  });

  /** The reader's own seat rides along with every page; off the page it is pinned, not listed. */
  it('keeps a seat that is not on the page out of the page', () => {
    const { rows: page } = splitBoard([seat(1), seat(4), seat(5), seat(40)], pageRanks(1, 5));

    assert.deepEqual(
      page.map((row) => row.rank),
      [4, 5],
    );
  });
});

describe('pageRanks', () => {
  it('starts page one under the podium and each later page where the last ended', () => {
    assert.deepEqual(pageRanks(1, 20), { from: 4, to: 23 });
    assert.deepEqual(pageRanks(2, 20), { from: 24, to: 43 });
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
