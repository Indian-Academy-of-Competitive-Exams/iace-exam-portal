/**
 * Empties the e2e database and stands up one sittable paper: a FREE series, so any student who
 * signs up reaches it, holding one offered two-question test. Built with the database tier's own
 * builders and the real finalize, so the paper is one an admin could have offered.
 */
import { TEST_SERIES_KIND } from '@iace/contracts';
import { PrismaService } from '../api/src/prisma/prisma.service';
import { makePaper, offerTest, resetDatabase } from '../api/test-db/support/database';
import { E2E_PAPER } from './e2e-env';

async function seed(): Promise<void> {
  const database = new URL(process.env.DATABASE_URL ?? '').pathname.slice(1);
  if (!database.endsWith('_e2e'))
    throw new Error(`refusing to empty "${database}": not an _e2e database`);

  const prisma = new PrismaService();
  try {
    await resetDatabase(prisma);
    const paper = await makePaper(prisma, {
      title: E2E_PAPER.TEST_TITLE,
      sections: ['General Awareness'],
      questions: E2E_PAPER.STEMS.map((stem) => ({ subject: 'General Awareness', stem })),
    });
    const questionCount = E2E_PAPER.STEMS.length;
    await prisma.baseConfigSection.update({
      where: { id: paper.sectionIds[0] ?? '' },
      data: { questionCount },
    });
    await prisma.baseConfig.update({
      where: { id: paper.catalog.baseConfigId },
      data: {
        totalQuestions: questionCount,
        totalMarks: questionCount * 2,
        durationSec: 600,
        languages: ['EN'],
      },
    });
    await prisma.testSeries.update({
      where: { id: paper.catalog.testSeriesId },
      data: { kind: TEST_SERIES_KIND.FREE, name: E2E_PAPER.SERIES_NAME },
    });
    await offerTest(prisma, paper.testId, true);
  } finally {
    await prisma.$disconnect();
  }
}

void seed();
