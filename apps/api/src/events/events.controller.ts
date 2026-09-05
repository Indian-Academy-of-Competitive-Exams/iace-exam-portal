import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ActorTypes,
  addEventCandidatesSchema,
  createEventSchema,
  eventCandidateListQuerySchema,
  eventListQuerySchema,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  updateEventSchema,
  type AddEventCandidatesBody,
  type CreateEventBody,
  type Event,
  type EventCandidate,
  type EventCandidateListQuery,
  type EventListQuery,
  type Paginated,
  type UpdateEventBody,
} from '@iace/contracts';
import { Actors, RequiresFeature } from '../common/security';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { EventsService } from './events.service';

/** Who an EVENT series reaches — sitters, not necessarily students yet. */
@Controller('admin/events')
@Actors(ActorTypes.ADMIN)
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get()
  list(
    @Query(new ZodQuery(eventListQuerySchema)) query: EventListQuery,
  ): Promise<Paginated<Event>> {
    return this.events.list(query);
  }

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get(':id')
  detail(@Param('id') id: string): Promise<Event> {
    return this.events.detail(id);
  }

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post()
  create(@Body(new ZodBody(createEventSchema)) body: CreateEventBody): Promise<Event> {
    return this.events.create(body);
  }

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodBody(updateEventSchema)) body: UpdateEventBody,
  ): Promise<Event> {
    return this.events.update(id, body);
  }

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string): Promise<void> {
    return this.events.remove(id);
  }

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get(':id/candidates')
  candidates(
    @Param('id') id: string,
    @Query(new ZodQuery(eventCandidateListQuerySchema)) query: EventCandidateListQuery,
  ): Promise<Paginated<EventCandidate>> {
    return this.events.candidates(id, query);
  }

  /** A whole roster in one write — the import screen's commit, not a row at a time. */
  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post(':id/candidates')
  @HttpCode(HttpStatus.OK)
  addCandidates(
    @Param('id') id: string,
    @Body(new ZodBody(addEventCandidatesSchema)) body: AddEventCandidatesBody,
  ): Promise<EventCandidate[]> {
    return this.events.addCandidates(id, body.studentIds);
  }

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Delete(':id/candidates/:studentId')
  @HttpCode(HttpStatus.OK)
  removeCandidate(@Param('id') id: string, @Param('studentId') studentId: string): Promise<void> {
    return this.events.removeCandidate(id, studentId);
  }
}
