import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ActorTypes,
  type BookmarkQuestionBody,
  type BookmarkedInAttempt,
  type Paginated,
  type SavedListQuery,
  type SavedQuestion,
  type SavedFacets,
  type SavedFacetsQuery,
  bookmarkQuestionSchema,
  savedListQuerySchema,
  savedFacetsQuerySchema,
} from '@iace/contracts';
import { Actors, CurrentUser, type AuthenticatedUser } from '../common/security';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { SavedQuestionsService } from './saved-questions.service';

/** The student's two lists. No id names a student here — the token is the subject, as under `me`. */
@Controller('me/saved')
@Actors(ActorTypes.STUDENT)
export class SavedController {
  constructor(private readonly saved: SavedQuestionsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodQuery(savedListQuerySchema)) query: SavedListQuery,
  ): Promise<Paginated<SavedQuestion>> {
    return this.saved.list(user.id, query);
  }

  /** What both filters offer. A separate read: the options must span every page, not one. */
  @Get('facets')
  facets(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodQuery(savedFacetsQuerySchema)) query: SavedFacetsQuery,
  ): Promise<SavedFacets> {
    return this.saved.facets(user.id, query.kind);
  }

  /** Offered only on the review surface, and refused until that sitting's solutions have opened. */
  @Post('bookmarks')
  @HttpCode(HttpStatus.OK)
  bookmark(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(bookmarkQuestionSchema)) body: BookmarkQuestionBody,
  ): Promise<SavedQuestion> {
    return this.saved.bookmark(user.id, body);
  }

  @Get('bookmarks/attempts/:attemptId')
  bookmarkedIn(
    @CurrentUser() user: AuthenticatedUser,
    @Param('attemptId') attemptId: string,
  ): Promise<BookmarkedInAttempt> {
    return this.saved.bookmarkedIn(user.id, attemptId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    return this.saved.remove(user.id, id);
  }
}
