import { canonicalName } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { emptyTaxonomy, type TaxonomyContext } from './question-core';

/**
 * Reading the taxonomy the way each entry path needs it: by id for one question,
 * and whole, keyed by name, for a sheet and for the template's dropdowns.
 */

export interface TaxonomyIds {
  subjectIds: string[];
  topicIds: string[];
  subTopicIds: string[];
}

/** Exactly the rows one draft points at — three bounded reads, never a table scan. */
export async function taxonomyForIds(
  prisma: PrismaService,
  ids: TaxonomyIds,
): Promise<TaxonomyContext> {
  const taxonomy = emptyTaxonomy();

  const [subjects, topics, subTopics] = await Promise.all([
    ids.subjectIds.length > 0
      ? prisma.subject.findMany({
          where: { id: { in: ids.subjectIds } },
          select: { id: true, name: true },
        })
      : [],
    ids.topicIds.length > 0
      ? prisma.topic.findMany({
          where: { id: { in: ids.topicIds } },
          select: { id: true, name: true, subjectId: true },
        })
      : [],
    ids.subTopicIds.length > 0
      ? prisma.subTopic.findMany({
          where: { id: { in: ids.subTopicIds } },
          select: { id: true, name: true, topics: { select: { id: true } } },
        })
      : [],
  ]);

  for (const subject of subjects) taxonomy.subjects.set(subject.id, subject);
  for (const topic of topics) taxonomy.topics.set(topic.id, topic);
  for (const subTopic of subTopics) {
    taxonomy.subTopics.set(subTopic.id, {
      id: subTopic.id,
      name: subTopic.name,
      topicIds: subTopic.topics.map((topic) => topic.id),
    });
  }

  return taxonomy;
}

export interface CatalogSubTopic {
  id: string;
  name: string;
}

export interface CatalogTopic {
  id: string;
  name: string;
  subTopics: CatalogSubTopic[];
}

export interface CatalogSubject {
  id: string;
  name: string;
  topics: CatalogTopic[];
}

/**
 * The whole taxonomy, once. A sheet names its rows rather than pointing at ids,
 * so every row is resolved against these maps instead of querying per line — and
 * the template's dropdowns are generated from the same read.
 */
export interface TaxonomyCatalog {
  context: TaxonomyContext;
  subjects: CatalogSubject[];
  subjectIdByName: Map<string, string>;
  /** Keyed by subject, because a topic name is only unique within one. */
  topicIdBySubjectAndName: Map<string, string>;
  /** A sub-topic name is unique table-wide, which is what makes it shareable. */
  subTopicIdByName: Map<string, string>;
}

export const topicKey = (subjectId: string, name: string) => `${subjectId}/${name}`;

export async function loadTaxonomyCatalog(prisma: PrismaService): Promise<TaxonomyCatalog> {
  const subjects = await prisma.subject.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      topics: {
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          subTopics: { orderBy: { name: 'asc' }, select: { id: true, name: true } },
        },
      },
    },
  });

  const context = emptyTaxonomy();
  const subjectIdByName = new Map<string, string>();
  const topicIdBySubjectAndName = new Map<string, string>();
  const subTopicIdByName = new Map<string, string>();
  const subTopicTopics = new Map<string, string[]>();

  for (const subject of subjects) {
    context.subjects.set(subject.id, { id: subject.id, name: subject.name });
    subjectIdByName.set(subject.name, subject.id);

    for (const topic of subject.topics) {
      context.topics.set(topic.id, { id: topic.id, name: topic.name, subjectId: subject.id });
      topicIdBySubjectAndName.set(topicKey(subject.id, topic.name), topic.id);

      for (const subTopic of topic.subTopics) {
        subTopicIdByName.set(subTopic.name, subTopic.id);
        const topics = subTopicTopics.get(subTopic.id) ?? [];
        topics.push(topic.id);
        subTopicTopics.set(subTopic.id, topics);
        context.subTopics.set(subTopic.id, {
          id: subTopic.id,
          name: subTopic.name,
          topicIds: topics,
        });
      }
    }
  }

  return {
    context,
    subjects: subjects.map((subject) => ({
      id: subject.id,
      name: subject.name,
      topics: subject.topics.map((topic) => ({
        id: topic.id,
        name: topic.name,
        subTopics: topic.subTopics,
      })),
    })),
    subjectIdByName,
    topicIdBySubjectAndName,
    subTopicIdByName,
  };
}

/** A name from a sheet, in the form the tables store. Normalised, never rejected. */
export const lookupName = (value: string): string => canonicalName(value);
