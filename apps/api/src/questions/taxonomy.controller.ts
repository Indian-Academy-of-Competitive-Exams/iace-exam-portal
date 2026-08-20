import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ActorTypes,
  AUDIT_ACTION,
  AUDIT_FEATURE,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  createSubjectSchema,
  createTopicSchema,
  subjectListQuerySchema,
  topicListQuerySchema,
  updateSubjectSchema,
  updateTopicSchema,
  type CreateSubjectBody,
  type CreateTopicBody,
  type Paginated,
  type Subject,
  type SubjectListQuery,
  type Topic,
  type TopicListQuery,
  type UpdateSubjectBody,
  type UpdateTopicBody,
} from '@iace/contracts';
import { Actors, RequiresFeature } from '../common/security';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { Audit } from '../audit';
import { TaxonomyService } from './taxonomy.service';

/**
 * Subject and topic. Reading is READ on the question bank because
 * every picker on a question screen needs it; writing is WRITE, because a name
 * added here is a name every question and every draw is filed under.
 */
@Controller('admin')
@Actors(ActorTypes.ADMIN)
export class TaxonomyController {
  constructor(private readonly taxonomy: TaxonomyService) {}

  @RequiresFeature(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get('subjects')
  listSubjects(
    @Query(new ZodQuery(subjectListQuerySchema)) query: SubjectListQuery,
  ): Promise<Paginated<Subject>> {
    return this.taxonomy.listSubjects(query);
  }

  @Audit(AUDIT_FEATURE.TAXONOMY_SUBJECT, AUDIT_ACTION.CREATE)
  @RequiresFeature(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post('subjects')
  createSubject(@Body(new ZodBody(createSubjectSchema)) body: CreateSubjectBody): Promise<Subject> {
    return this.taxonomy.createSubject(body);
  }

  @Audit(AUDIT_FEATURE.TAXONOMY_SUBJECT, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Patch('subjects/:id')
  updateSubject(
    @Param('id') id: string,
    @Body(new ZodBody(updateSubjectSchema)) body: UpdateSubjectBody,
  ): Promise<Subject> {
    return this.taxonomy.updateSubject(id, body);
  }

  @RequiresFeature(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get('topics')
  listTopics(
    @Query(new ZodQuery(topicListQuerySchema)) query: TopicListQuery,
  ): Promise<Paginated<Topic>> {
    return this.taxonomy.listTopics(query);
  }

  @Audit(AUDIT_FEATURE.TAXONOMY_TOPIC, AUDIT_ACTION.CREATE)
  @RequiresFeature(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post('topics')
  createTopic(@Body(new ZodBody(createTopicSchema)) body: CreateTopicBody): Promise<Topic> {
    return this.taxonomy.createTopic(body);
  }

  @Audit(AUDIT_FEATURE.TAXONOMY_TOPIC, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Patch('topics/:id')
  updateTopic(
    @Param('id') id: string,
    @Body(new ZodBody(updateTopicSchema)) body: UpdateTopicBody,
  ): Promise<Topic> {
    return this.taxonomy.updateTopic(id, body);
  }
}
