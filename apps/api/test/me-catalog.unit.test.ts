import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type StudentCatalog, type StudentCatalogTest } from '@iace/contracts';
import { MeService } from '../src/me/me.service';
import { type AccessResolverService } from '../src/access';
import { type LeaderboardService } from '../src/attempts';
import { type StorageService } from '../src/storage/storage.service';
import { type StudentsService } from '../src/students';
import { type AuditContext } from '../src/audit';

const test = (id: string): StudentCatalogTest => ({
  id,
  title: `Mock ${id}`,
  durationSec: 3600,
  totalQuestions: 100,
  totalMarks: 200,
  order: 1,
  opensAt: null,
  attemptStatus: null,
  canStart: true,
  sittingCount: null,
});

const catalogOf = (...testIds: string[]): StudentCatalog => ({
  testBlocked: false,
  series: [
    {
      id: 'ser_1',
      name: 'SSC CGL Full Mocks',
      description: null,
      examStage: null,
      programCode: null,
      kind: 'FREE',
      sequentialTests: false,
      tests: testIds.map(test),
    },
  ],
});

function build(counts: ReadonlyMap<string, number>, catalog: StudentCatalog) {
  const asked: string[][] = [];
  const access = { catalog: () => Promise.resolve(catalog) } as unknown as AccessResolverService;
  const leaderboard = {
    sittingCounts: (ids: readonly string[]) => {
      asked.push([...ids]);
      return Promise.resolve(counts);
    },
  } as unknown as LeaderboardService;

  return {
    asked,
    me: new MeService(
      {} as StudentsService,
      {} as StorageService,
      access,
      leaderboard,
      {} as AuditContext,
    ),
  };
}

describe('MeService.catalog — the crowd read live onto a cached catalog', () => {
  it('puts each board’s count on its own test, joined by test id', async () => {
    const { me } = build(new Map([['tst_b', 1284]]), catalogOf('tst_a', 'tst_b'));

    const tests = (await me.catalog('stu_1')).series[0]?.tests ?? [];

    assert.equal(tests.find((row) => row.id === 'tst_b')?.sittingCount, 1284);
  });

  /** The resolver caches its payload per student, so a crowd it carried would be a stale one. */
  it('leaves a test with no board at null rather than inventing a zero', async () => {
    const { me } = build(new Map([['tst_b', 1284]]), catalogOf('tst_a', 'tst_b'));

    const tests = (await me.catalog('stu_1')).series[0]?.tests ?? [];

    assert.equal(tests.find((row) => row.id === 'tst_a')?.sittingCount, null);
  });

  it('asks the board for every listed test in ONE call, not one call per test', async () => {
    const { me, asked } = build(new Map(), catalogOf('tst_a', 'tst_b', 'tst_c'));

    await me.catalog('stu_1');

    assert.deepEqual(asked, [['tst_a', 'tst_b', 'tst_c']]);
  });
});
