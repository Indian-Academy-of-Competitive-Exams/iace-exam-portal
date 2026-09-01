/**
 * The one screen that shows other students by name, and it is safe only because it is behind
 * the global JWT guard and reachable by a STUDENT token alone. Never add @Public() here, never
 * add a token-addressed twin: a shared link carries one student's OWN report, not a board.
 */
import { Controller, Get, Query } from '@nestjs/common';
import {
  ActorTypes,
  leaderboardQuerySchema,
  type Leaderboard,
  type LeaderboardQuery,
} from '@iace/contracts';
import { Actors, CurrentUser, type AuthenticatedUser } from '../common/security';
import { ZodQuery } from '../common/zod-validation.pipe';
import { LeaderboardViewService } from './leaderboard-view.service';

@Controller('me/leaderboard')
@Actors(ActorTypes.STUDENT)
export class MeLeaderboardController {
  constructor(private readonly board: LeaderboardViewService) {}

  /** This paper, this series or every paper they have sat — the reader is always the token's. */
  @Get()
  read(
    @Query(new ZodQuery(leaderboardQuerySchema)) query: LeaderboardQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Leaderboard> {
    return this.board.board(user.id, query);
  }
}
