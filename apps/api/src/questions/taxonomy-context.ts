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
}

/** Exactly the rows one draft points at — two bounded reads, never a table scan. */
export async function taxonomyForIds(
  prisma: PrismaService,
  ids: TaxonomyIds,
): Promise<TaxonomyContext> {
  const taxonomy = emptyTaxonomy();

  const [subjects, topics] = await Promise.all([
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
  ]);

  for (const subject of subjects) taxonomy.subjects.set(subject.id, subject);
  for (const topic of topics) taxonomy.topics.set(topic.id, topic);

  return taxonomy;
}

export interface CatalogTopic {
  id: string;
  name: string;
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
}

export const topicKey = (subjectId: string, name: string) => `${subjectId}/${name}`;

export async function loadTaxonomyCatalog(prisma: PrismaService): Promise<TaxonomyCatalog> {
  const subjects = await prisma.subject.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      topics: { orderBy: { name: 'asc' }, select: { id: true, name: true } },
    },
  });

  const context = emptyTaxonomy();
  const subjectIdByName = new Map<string, string>();
  const topicIdBySubjectAndName = new Map<string, string>();

  for (const subject of subjects) {
    context.subjects.set(subject.id, { id: subject.id, name: subject.name });
    subjectIdByName.set(subject.name, subject.id);

    for (const topic of subject.topics) {
      context.topics.set(topic.id, { id: topic.id, name: topic.name, subjectId: subject.id });
      topicIdBySubjectAndName.set(topicKey(subject.id, topic.name), topic.id);
    }
  }

  return {
    context,
    subjects: subjects.map((subject) => ({
      id: subject.id,
      name: subject.name,
      topics: subject.topics,
    })),
    subjectIdByName,
    topicIdBySubjectAndName,
  };
}

/** A name from a sheet, in the form the tables store. Normalised, never rejected. */
export const lookupName = (value: string): string => canonicalName(value);
