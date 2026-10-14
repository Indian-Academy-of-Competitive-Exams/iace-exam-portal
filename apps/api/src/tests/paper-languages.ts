/** Which questions on a paper lack a language their section is sat in; a section of its own languages owes no other. */
import { Prisma } from '@prisma/client';
import { contentLanguageOf, type LanguageCode, type PaperLanguageGap } from '@iace/contracts';

type Reader = Pick<Prisma.TransactionClient, '$queryRaw'>;

/** A question carries a language when its pinned version's content holds that key, which only an authored stem writes. */
export async function paperLanguageGaps(
  db: Reader,
  testId: string,
  languages: readonly LanguageCode[],
): Promise<PaperLanguageGap[]> {
  const gaps: PaperLanguageGap[] = [];
  for (const language of languages) {
    const rows = await db.$queryRaw<{ section: string; missing: number }[]>`
      SELECT s."name" AS section, count(*)::int AS missing
      FROM "PaperQuestion" pq
      JOIN "QuestionVersion" v ON v."id" = pq."questionVersionId"
      JOIN "BaseConfigSection" s ON s."id" = pq."baseConfigSectionId"
      WHERE pq."testId" = ${testId}::uuid
        AND pq."status" <> 'DROPPED'
        AND NOT jsonb_exists(v."content", ${contentLanguageOf(language)})
        AND (cardinality(s."languages") = 0 OR ${language}::"SupportedLanguage" = ANY(s."languages"))
      GROUP BY s."name", s."order"
      ORDER BY s."order"`;
    gaps.push(...rows.map((row) => ({ ...row, language })));
  }
  return gaps;
}
