/**
 * DEV-ONLY: a throwaway question pool, so the test builder and draw engine have something to
 * draw in the shape the app really writes. Every row is tagged `dummy` and its id prefixed
 * `qd_`, so `--reset` purges the pool and nothing else. Refuses a DATABASE_URL that does not
 * look local. Run: node scripts/dev-seed-questions.mjs [--reset]
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

// --- env: load DATABASE_URL from .env if the shell has not already ---
if (!process.env.DATABASE_URL) {
  try {
    const line = readFileSync(new URL('../.env', import.meta.url), 'utf8')
      .split('\n')
      .find((l) => l.startsWith('DATABASE_URL='));
    if (line)
      process.env.DATABASE_URL = line
        .slice('DATABASE_URL='.length)
        .trim()
        .replace(/^["']|["']$/g, '');
  } catch {
    /* no .env — rely on the shell */
  }
}

const url = process.env.DATABASE_URL ?? '';
const looksLocal = /@(localhost|127\.0\.0\.1|host\.docker\.internal|postgres|db)[:/]/.test(url);
if (!looksLocal && process.env.FORCE_DEV_SEED !== '1') {
  console.error(
    `Refusing to run: DATABASE_URL does not look local.\n  ${url || '(unset)'}\n  Set FORCE_DEV_SEED=1 to override on a disposable database.`,
  );
  process.exit(1);
}

const DIFFICULTIES = ['LOW', 'MEDIUM', 'HIGH'];
const OPTS = 4;
const CHUNK = 500;
const text = (t) => [{ type: 'TEXT', text: `<div><p>${t}</p></div>` }];

function build(subject, difficulty, i) {
  const slug = subject.code ? subject.code.toLowerCase() : subject.id.replace(/^subject_/, '');
  const id = `qd_${slug}_${difficulty[0].toLowerCase()}_${i}`;
  const versionId = `qv_${slug}_${difficulty[0].toLowerCase()}_${i}`;
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
      stemHash: id,
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
      console.log(
        `A dummy pool already exists (${existing} questions). Pass --reset to rebuild. Nothing changed.`,
      );
      return;
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

    // Demand = questions each subject's config sections ask for; generate ~2x, split by difficulty.
    const demand = await prisma.baseConfigSection.groupBy({
      by: ['subjectId'],
      _sum: { questionCount: true },
      _max: { questionCount: true },
      where: { subjectId: { not: null } },
    });
    const subjects = await prisma.subject.findMany();
    const byId = new Map(subjects.map((s) => [s.id, s]));

    let total = 0;
    for (const d of demand) {
      const subject = byId.get(d.subjectId);
      if (!subject) continue;
      const need = Math.max((d._sum.questionCount ?? 0) * 2, (d._max.questionCount ?? 0) * 3, 300);
      const per = Math.max(Math.ceil(need / DIFFICULTIES.length), d._max.questionCount ?? 0, 100);
      for (const difficulty of DIFFICULTIES) {
        const rows = Array.from({ length: per }, (_, k) => build(subject, difficulty, k + 1));
        for (let start = 0; start < rows.length; start += CHUNK) {
          const chunk = rows.slice(start, start + CHUNK);
          await prisma.$transaction([
            prisma.question.createMany({
              data: chunk.map((r) => r.question),
              skipDuplicates: true,
            }),
            prisma.questionVersion.createMany({
              data: chunk.map((r) => r.version),
              skipDuplicates: true,
            }),
          ]);
          total += chunk.length;
        }
      }
      console.log(`  ${subject.name}: ${per * DIFFICULTIES.length} questions (${per}/difficulty)`);
    }
    // Second pass: point each question at its version, now that every version exists.
    const linked = await prisma.$executeRawUnsafe(
      `UPDATE "Question" SET "currentVersionId" = 'qv_' || substring("id" from 4) WHERE 'dummy' = ANY("tags") AND "currentVersionId" IS NULL`,
    );

    console.log(
      `\nDone. ${total} dummy questions across ${demand.length} subjects (${linked} linked to versions).`,
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
