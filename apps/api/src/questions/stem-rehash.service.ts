import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { type AnswerKeyDraft, type LocalizedContent } from '@iace/contracts';
import { API_ROLES, servesRole } from '../config/api-role';
import { PrismaService } from '../prisma/prisma.service';
import { STEM_HASH_VERSION, storedStemHash } from './question-core';
import { optionsIn } from '../common/prisma-json';

/** Questions read and rewritten per round trip. */
const REHASH_BATCH = 500;

/** Brings every stored stemHash up to the fold the code hashes with, so dedup compares like with like. */
@Injectable()
export class StemRehashService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StemRehashService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Not awaited: boot must not wait on a bank-sized pass, and a failed pass is retried on the next boot. */
  onApplicationBootstrap(): void {
    if (!servesRole(API_ROLES.WORKER)) return;
    this.rehash().then(
      (count) => {
        if (count > 0)
          this.logger.log(`Rehashed ${count} question stems to version ${STEM_HASH_VERSION}`);
      },
      (error: unknown) =>
        this.logger.error('Stem rehash failed; it runs again on the next boot', error),
    );
  }

  async rehash(): Promise<number> {
    let rehashed = 0;
    let after: string | undefined;

    for (;;) {
      const rows = await this.prisma.question.findMany({
        where: {
          stemHashVersion: { lt: STEM_HASH_VERSION },
          ...(after === undefined ? {} : { id: { gt: after } }),
        },
        orderBy: { id: 'asc' },
        take: REHASH_BATCH,
        select: {
          id: true,
          type: true,
          stemHash: true,
          updatedAt: true,
          currentVersion: { select: { content: true, options: true, answerKey: true } },
        },
      });
      if (rows.length === 0) return rehashed;
      after = rows.at(-1)?.id;

      const hashes = rows.map((row) =>
        row.currentVersion
          ? storedStemHash({
              type: row.type,
              content: row.currentVersion.content as LocalizedContent,
              options: optionsIn(row.currentVersion.options),
              answerKey: row.currentVersion.answerKey as AnswerKeyDraft | null,
            })
          : row.stemHash,
      );

      // Raw, so "updatedAt" stays put: the editor reads it to spot an edit made elsewhere, and an edit that landed since the read wins.
      rehashed += await this.prisma.$executeRaw`
        UPDATE "Question" AS q
        SET "stemHash" = v.hash, "stemHashVersion" = ${STEM_HASH_VERSION}
        FROM unnest(
          ${rows.map((row) => row.id)}::uuid[],
          ${hashes}::text[],
          ${rows.map((row) => row.updatedAt)}::timestamptz[]
        ) AS v(id, hash, seen)
        WHERE q.id = v.id AND q."updatedAt" = v.seen AND q."stemHashVersion" < ${STEM_HASH_VERSION}`;
    }
  }
}
