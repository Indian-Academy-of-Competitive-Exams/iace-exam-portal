import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import {
  AppException,
  EXAM_COURSE,
  EXAM_MODE,
  ErrorCodes,
  STAGE_DISPOSITION,
  examStageListQuerySchema,
  type ExamCourse,
  type ExamStageListQuery,
  type ExamStageListQueryInput,
  type StageDisposition,
} from '@iace/contracts';
import { AuditContext } from '../src/audit';
import { ExamStagesService } from '../src/configs/exam-stages.service';
import { resetDatabase, testPrisma, uid } from './support/database';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const idCache = new Map<string, string>();
const idFor = (label: string): string => {
  const cached = idCache.get(label);
  if (cached) return cached;
  const id = randomUUID();
  idCache.set(label, id);
  return id;
};

const SSC_CGL = {
  id: idFor('exam_1'),
  code: 'SSC CGL',
  name: 'SSC CGL',
  course: EXAM_COURSE.SSC as ExamCourse,
};

interface StageRow {
  id?: string;
  examId?: string;
  stageKey?: string;
  name?: string;
  isActive?: boolean;
  disposition?: StageDisposition;
  /** What hangs off the stage: base configs, and tests and series built on them. */
  hanging?: { baseConfigs?: number; tests?: number; series?: number };
}

/** The exams given — SSC CGL unless told otherwise — and the stages given under them. */
async function serviceWith(stages: StageRow[] = [{}], exams: (typeof SSC_CGL)[] = [SSC_CGL]) {
  await prisma.exam.createMany({ data: exams });
  for (const { hanging = {}, ...stage } of stages) {
    const row = await prisma.examStage.create({
      data: {
        id: idFor('stage_1'),
        examId: idFor('exam_1'),
        stageKey: 'SSC_CGL_T1',
        name: 'Tier 1',
        ...stage,
      },
    });
    await hang(row.id, hanging);
  }
  return new ExamStagesService(prisma, new AuditContext());
}

/** Base configs, series and tests on the stage — each test on the first config and in the first series. */
async function hang(examStageId: string, counts: NonNullable<StageRow['hanging']>) {
  const configs: string[] = [];
  const series: string[] = [];
  const needed = (counts.tests ?? 0) > 0;
  for (let n = 0; n < Math.max(counts.baseConfigs ?? 0, needed ? 1 : 0); n += 1) {
    const config = await prisma.baseConfig.create({
      data: {
        examStageId,
        name: uid(),
        totalQuestions: 1,
        totalMarks: 2,
        durationSec: 60,
      },
    });
    configs.push(config.id);
  }
  for (let n = 0; n < Math.max(counts.series ?? 0, needed ? 1 : 0); n += 1) {
    series.push((await prisma.testSeries.create({ data: { examStageId, name: uid() } })).id);
  }
  for (let n = 0; n < (counts.tests ?? 0); n += 1) {
    await prisma.test.create({
      data: {
        examStageId,
        baseConfigId: configs[0] ?? '',
        testSeriesId: series[0] ?? '',
        title: uid(),
      },
    });
  }
}

const listQuery = (over: Partial<ExamStageListQueryInput> = {}): ExamStageListQuery =>
  examStageListQuerySchema.parse({ page: '1', pageSize: '20', ...over });

const RRB_JE = {
  id: idFor('exam_2'),
  code: 'RRB JE',
  name: 'RRB JE',
  course: EXAM_COURSE.RRB as ExamCourse,
};

const refusedWith = (code: string, field?: string) => (error: unknown) =>
  AppException.is(error) &&
  error.code === code &&
  (field === undefined || Boolean(error.fieldErrors?.[field]));

const stageRow = () => prisma.examStage.findUniqueOrThrow({ where: { id: idFor('stage_1') } });

describe('ExamStagesService — listing', () => {
  it('names the exam and its course on every row, so a stage never reads bare', async () => {
    const service = await serviceWith();

    const [stage] = (await service.list(listQuery())).items;

    assert.equal(stage?.exam.code, 'SSC CGL');
    assert.equal(stage?.exam.course, EXAM_COURSE.SSC);
  });

  it('narrows to one exam, to any of the exams chosen, and to every stage when the filter is emptied', async () => {
    const service = await serviceWith(
      [
        {},
        { id: idFor('stage_2'), examId: idFor('exam_2'), stageKey: 'RRB_JE_CBT1' },
        { id: idFor('stage_3'), examId: idFor('exam_3'), stageKey: 'IBPS_PO_PRE' },
      ],
      [
        SSC_CGL,
        RRB_JE,
        { id: idFor('exam_3'), code: 'IBPS PO', name: 'IBPS PO', course: EXAM_COURSE.BANKING },
      ],
    );

    const one = await service.list(listQuery({ examId: idFor('exam_2') }));
    assert.deepEqual(
      one.items.map((stage) => stage.stageKey),
      ['RRB_JE_CBT1'],
    );
    assert.equal(
      (await service.list(listQuery({ examId: [idFor('exam_1'), idFor('exam_3')] }))).total,
      2,
    );
    assert.equal((await service.list(listQuery({ examId: [] }))).total, 3);
  });

  /** The Exams screen filters by course; a stage reaches one only through its exam. */
  it('narrows to one course, through the exam above it', async () => {
    const service = await serviceWith(
      [{}, { id: idFor('stage_2'), examId: idFor('exam_2'), stageKey: 'RRB_JE_CBT1' }],
      [SSC_CGL, RRB_JE],
    );

    const page = await service.list(listQuery({ course: EXAM_COURSE.RRB }));

    assert.deepEqual(
      page.items.map((stage) => stage.exam.code),
      ['RRB JE'],
    );
  });

  it('hides retired stages when the caller asks for active ones only', async () => {
    const service = await serviceWith([
      {},
      { id: idFor('stage_2'), stageKey: 'SSC_CGL_T2', isActive: false },
    ]);

    assert.equal((await service.list(listQuery())).total, 2);
    assert.equal((await service.list(listQuery({ activeOnly: 'true' }))).total, 1);
  });
});

describe('ExamStagesService — searching', () => {
  const found = async (q: string) => {
    const service = await serviceWith(
      [
        { stageKey: 'SSC_CGL_T1', name: 'Tier 1' },
        { id: idFor('stage_2'), stageKey: 'SSC_CGL_T2', name: 'Tier 2' },
        { id: idFor('stage_3'), examId: idFor('exam_2'), stageKey: 'SSC_CHSL_T1', name: 'Tier 1' },
      ],
      [
        SSC_CGL,
        { id: idFor('exam_2'), code: 'SSC CHSL', name: 'SSC CHSL', course: EXAM_COURSE.SSC },
      ],
    );
    const ids = (await service.list(listQuery({ q }))).items.map((stage) => stage.id);
    await resetDatabase(prisma);
    return ids;
  };

  /** Every word has to land somewhere — the exam code, the tier, or the key — or the search narrows nothing. */
  it('finds a stage by its exam code, by exam and tier together, and by its key, and nothing past a word that misses', async () => {
    assert.deepEqual(await found('CHSL'), [idFor('stage_3')]);
    assert.deepEqual(await found('SSC CGL Tier 2'), [idFor('stage_2')]);
    assert.deepEqual(await found('SSC_CHSL_T1'), [idFor('stage_3')]);
    assert.deepEqual(await found('SSC CGL Tier 9'), []);
  });
});

describe('ExamStagesService — creating', () => {
  it('creates a stage under an exam, defaulting mode and disposition', async () => {
    const service = await serviceWith([]);

    const created = await service.create({
      examId: idFor('exam_1'),
      stageKey: 'SSC_CGL_T2',
      name: 'Tier 2',
    });

    assert.equal(created.stageKey, 'SSC_CGL_T2');
    assert.equal(created.mode, EXAM_MODE.CBT);
    assert.equal(created.disposition, STAGE_DISPOSITION.CONDUCTED);
    assert.equal(await prisma.examStage.count(), 1);
  });

  /** The key is unique table-wide: a second "SSC_CGL_T1" would mean two things to a seed script. */
  it('refuses a stage key another exam already uses, and an exam that is not there', async () => {
    const service = await serviceWith();

    await assert.rejects(
      () =>
        service.create({ examId: idFor('exam_1'), stageKey: 'SSC_CGL_T1', name: 'Tier 1 again' }),
      refusedWith(ErrorCodes.CONFLICT, 'stageKey'),
    );
    await assert.rejects(
      () => service.create({ examId: randomUUID(), stageKey: 'SSC_CGL_T9', name: 'Tier 9' }),
      refusedWith(ErrorCodes.VALIDATION_ERROR, 'examId'),
    );
  });
});

describe('ExamStagesService — updating', () => {
  it('renames, reorders, retires and reactivates a stage, and changes its key while nothing hangs off it', async () => {
    const service = await serviceWith();

    const renamed = await service.update(idFor('stage_1'), { name: 'Prelims', order: 0 });
    assert.deepEqual([renamed.name, renamed.order], ['Prelims', 0]);
    assert.equal((await service.update(idFor('stage_1'), { isActive: false })).isActive, false);
    assert.equal((await service.update(idFor('stage_1'), { isActive: true })).isActive, true);
    assert.equal(
      (await service.update(idFor('stage_1'), { stageKey: 'SSC_CGL_P1' })).stageKey,
      'SSC_CGL_P1',
    );
  });

  /** Nothing links a base config back to the key, so a change would detach it silently. */
  it('refuses a key change once a base config hangs off the stage, but takes the key re-sent unchanged', async () => {
    const service = await serviceWith([{ hanging: { baseConfigs: 2 } }]);

    await assert.rejects(
      () => service.update(idFor('stage_1'), { stageKey: 'SSC_CGL_P1' }),
      refusedWith(ErrorCodes.CONFLICT, 'stageKey'),
    );
    assert.equal((await stageRow()).stageKey, 'SSC_CGL_T1', 'nothing should have been written');

    const updated = await service.update(idFor('stage_1'), {
      stageKey: 'SSC_CGL_T1',
      disposition: STAGE_DISPOSITION.PARTIAL,
    });
    assert.equal(updated.disposition, STAGE_DISPOSITION.PARTIAL);
  });

  it('answers NOT_FOUND for a stage that is not there', async () => {
    const service = await serviceWith([]);

    await assert.rejects(
      () => service.update(randomUUID(), { isActive: false }),
      refusedWith(ErrorCodes.NOT_FOUND),
    );
  });
});

describe('ExamStagesService — deleting', () => {
  it('deletes a stage nothing hangs off', async () => {
    const service = await serviceWith();

    await service.remove(idFor('stage_1'));

    assert.equal(await prisma.examStage.count(), 0);
  });

  /** A base config cascades to its sections, so this delete would take the blueprints with it. */
  it('refuses one that still carries base configs, tests or series, and names each', async () => {
    const service = await serviceWith([{ hanging: { baseConfigs: 1, tests: 3, series: 2 } }]);

    const error = await service.remove(idFor('stage_1')).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.match(error.message, /1 base config\b/);
    assert.match(error.message, /3 tests/);
    assert.match(error.message, /2 series/);
    assert.equal(await prisma.examStage.count(), 1, 'nothing should have been deleted');
  });
});

describe('ExamStagesService.assertUsable — the seam configs and tests come through', () => {
  it('accepts an active stage, and a partly-conducted one, which does carry the objective paper', async () => {
    const service = await serviceWith([
      {},
      { id: idFor('stage_2'), stageKey: 'SSC_CGL_T2', disposition: STAGE_DISPOSITION.PARTIAL },
    ]);

    await assert.doesNotReject(() => service.assertUsable(idFor('stage_1')));
    await assert.doesNotReject(() => service.assertUsable(idFor('stage_2')));
  });

  it('refuses a retired one keyed to the field the caller names, and one that is not there', async () => {
    const service = await serviceWith([{ isActive: false }]);

    await assert.rejects(
      () => service.assertUsable(idFor('stage_1'), 'stageId'),
      refusedWith(ErrorCodes.VALIDATION_ERROR, 'stageId'),
    );
    await assert.rejects(() => service.assertUsable(randomUUID()), AppException.is);
  });

  /** CATALOG_ONLY exists so the journey reads whole on screen; nobody sits it, so nothing is built on it. */
  it('refuses a stage that is listed for the journey only', async () => {
    const service = await serviceWith([{ disposition: STAGE_DISPOSITION.CATALOG_ONLY }]);

    await assert.rejects(() => service.assertUsable(idFor('stage_1')), /journey/);
  });
});
