/**
 * DEV-ONLY: a throwaway question pool for the builder and the draw engine. Every row is tagged
 * `dummy`, so `--reset` purges the pool and nothing else. Every subject gets one, configured or
 * not; re-running tops up. Refuses a DATABASE_URL that is not local.
 * Run: node scripts/dev-seed-questions.mjs [--reset]
 */
import './dev-seed-env.mjs';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const DIFFICULTIES = ['LOW', 'MEDIUM', 'HIGH'];
const OPTS = 4;
const CHUNK = 500;
const text = (t) => [{ type: 'TEXT', text: `<div><p>${t}</p></div>` }];

function build(subject, difficulty, i) {
  const slug = (subject.code ?? subject.name).toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const id = randomUUID();
  const versionId = randomUUID();
  const correct = (i % OPTS) + 1;
  const options = Array.from({ length: OPTS }, (_, k) => {
    const position = k + 1;
    return {
      id: `o${position}`,
      position,
      isCorrect: position === correct,
      text: { en: text(`Option ${position}`), hi: text(`Vikalp ${position}`) },
    };
  });
  const tagText = slug.replace(/_/g, ' ');
  const content = {
    en: {
      stem: text(
        `[DUMMY] ${subject.name} — ${difficulty} practice question #${i}. Which option is correct?`,
      ),
      solution: text(`Option ${correct} is correct (dummy).`),
    },
    hi: { stem: text(`[DUMMY-HI] ${subject.name} prashna #${i}`) },
  };
  return {
    question: {
      id,
      questionCode: `QD-${slug.toUpperCase()}-${difficulty[0]}-${i}`,
      type: 'SINGLE_MCQ',
      subjectId: subject.id,
      difficulty,
      status: 'ACTIVE',
      // Set in a second pass: the currentVersion FK is immediate, so the version must exist first.
      currentVersionId: null,
      tags: ['dummy', tagText],
      // Null, not a stand-in: only canonicalStemKey can say what this is. Rehash after seeding.
      stemHash: null,
      fixedUseCount: 0,
    },
    version: { id: versionId, questionId: id, version: 1, content, options },
  };
}

async function main() {
  const reset = process.argv.includes('--reset');
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.question.count({ where: { tags: { has: 'dummy' } } });
    if (existing > 0 && !reset) {
      // Tops up rather than refusing: each subject/difficulty is filled only up to its target count.
      console.log(`A dummy pool exists (${existing} questions). Filling any gaps in it.`);
    }
    if (reset && existing > 0) {
      // Break the circular restrict (Question.currentVersionId <-> QuestionVersion) before deleting.
      await prisma.$executeRawUnsafe(
        `UPDATE "Question" SET "currentVersionId" = NULL WHERE 'dummy' = ANY("tags")`,
      );
      await prisma.$transaction([
        prisma.questionVersion.deleteMany({ where: { question: { tags: { has: 'dummy' } } } }),
        prisma.question.deleteMany({ where: { tags: { has: 'dummy' } } }),
      ]);
      console.log(`Purged ${existing} old dummy questions.`);
    }

    // Keyed, not iterated: EVERY subject gets a pool, including one no config asks for yet.
    const demand = new Map(
      (
        await prisma.baseConfigSection.groupBy({
          by: ['subjectId'],
          _sum: { questionCount: true },
          _max: { questionCount: true },
          where: { subjectId: { not: null } },
        })
      ).map((row) => [row.subjectId, row]),
    );
    const subjects = await prisma.subject.findMany({ orderBy: { name: 'asc' } });

    let total = 0;
    let linked = 0;
    for (const subject of subjects) {
      const asked = demand.get(subject.id);
      const sum = asked?._sum.questionCount ?? 0;
      const most = asked?._max.questionCount ?? 0;
      const need = Math.max(sum * 2, most * 3, 300);
      const per = Math.max(Math.ceil(need / DIFFICULTIES.length), most, 100);
      for (const difficulty of DIFFICULTIES) {
        const already = await prisma.question.count({
          where: { tags: { has: 'dummy' }, subjectId: subject.id, difficulty },
        });
        const shortfall = Math.max(per - already, 0);
        const rows = Array.from({ length: shortfall }, (_, k) =>
          build(subject, difficulty, already + k + 1),
        );
        for (let start = 0; start < rows.length; start += CHUNK) {
          const chunk = rows.slice(start, start + CHUNK);
          // Linked in the same transaction: the version must exist first, but the pair must land together.
          const links = chunk
            .map((r) => `('${r.question.id}'::uuid, '${r.version.id}'::uuid)`)
            .join(',');
          const [, , updated] = await prisma.$transaction([
            prisma.question.createMany({
              data: chunk.map((r) => r.question),
              skipDuplicates: true,
            }),
            prisma.questionVersion.createMany({
              data: chunk.map((r) => r.version),
              skipDuplicates: true,
            }),
            prisma.$executeRawUnsafe(
              `UPDATE "Question" AS q SET "currentVersionId" = v.vid FROM (VALUES ${links}) AS v(qid, vid) WHERE q.id = v.qid`,
            ),
          ]);
          total += chunk.length;
          linked += updated;
        }
      }
      const where = asked ? '' : ' — no config asks for it yet';
      console.log(`  ${subject.name}: ${per * DIFFICULTIES.length} (${per}/difficulty)${where}`);
    }

    console.log(
      `\nDone. ${total} dummy questions across ${subjects.length} subjects (${linked} linked to versions).`,
    );
    console.log(
      `Purge later with: node scripts/dev-seed-questions.mjs --reset  (or delete tag 'dummy').`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
