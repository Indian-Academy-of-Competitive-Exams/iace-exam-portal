import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AppException,
  ErrorCodes,
  EXAM_COURSE,
  EXAM_MODE,
  STAGE_DISPOSITION,
  examStageListQuerySchema,
  type ExamStageListQuery,
  type ExamStageListQueryInput,
} from '@iace/contracts';
import { ExamStagesController } from '../src/configs/exam-stages.controller';
import { ExamStagesService } from '../src/configs/exam-stages.service';
import { SUPER_ADMIN_KEY } from '../src/common/security';
import { AuditContext } from '../src/audit';
import {
  type FakeExam,
  type FakeExamStage,
  FakePrisma,
  makeExam,
  makeExamStage,
} from './support/fakes';

function serviceWith(
  stages: FakeExamStage[] = [makeExamStage()],
  exams: FakeExam[] = [makeExam()],
) {
  const prisma = new FakePrisma([], [], [], exams, stages);
  return { service: new ExamStagesService(prisma.asService(), new AuditContext()), prisma };
}

const listQuery = (over: Partial<ExamStageListQueryInput> = {}): ExamStageListQuery =>
  examStageListQuerySchema.parse({ page: '1', pageSize: '20', ...over });

describe('ExamStagesService — listing', () => {
  it('names the exam and its course on every row, so a stage never reads bare', async () => {
    const { service } = serviceWith();

    const [stage] = (await service.list(listQuery())).items;

    assert.equal(stage?.exam.code, 'SSC CGL');
    assert.equal(stage?.exam.course, EXAM_COURSE.SSC);
  });

  it('narrows to one exam', async () => {
    const { service } = serviceWith(
      [
        makeExamStage({ id: 'stage_1', examId: 'exam_1' }),
        makeExamStage({ id: 'stage_2', examId: 'exam_2', stageKey: 'RRB_JE_CBT1' }),
      ],
      [makeExam(), makeExam({ id: 'exam_2', code: 'RRB JE', name: 'RRB JE' })],
    );

    const page = await service.list(listQuery({ examId: 'exam_2' }));

    assert.equal(page.total, 1);
    assert.equal(page.items[0]?.stageKey, 'RRB_JE_CBT1');
  });

  it('narrows to any of the exams chosen, which is how a stage picker scopes itself', async () => {
    const { service } = serviceWith(
      [
        makeExamStage({ id: 'stage_1', examId: 'exam_1' }),
        makeExamStage({ id: 'stage_2', examId: 'exam_2', stageKey: 'RRB_JE_CBT1' }),
        makeExamStage({ id: 'stage_3', examId: 'exam_3', stageKey: 'IBPS_PO_PRE' }),
      ],
      [
        makeExam(),
        makeExam({ id: 'exam_2', code: 'RRB JE', name: 'RRB JE' }),
        makeExam({ id: 'exam_3', code: 'IBPS PO', name: 'IBPS PO' }),
      ],
    );

    const page = await service.list(listQuery({ examId: ['exam_1', 'exam_3'] }));

    assert.equal(page.total, 2);
  });

  /** An emptied filter is "any exam", so the picker must keep offering every stage. */
  it('lists every stage when the exam filter is emptied', async () => {
    const { service } = serviceWith(
      [
        makeExamStage({ id: 'stage_1', examId: 'exam_1' }),
        makeExamStage({ id: 'stage_2', examId: 'exam_2', stageKey: 'RRB_JE_CBT1' }),
      ],
      [makeExam(), makeExam({ id: 'exam_2', code: 'RRB JE', name: 'RRB JE' })],
    );

    assert.equal((await service.list(listQuery({ examId: [] }))).total, 2);
  });

  /** The Exams screen filters by course; a stage reaches one only through its exam. */
  it('narrows to one course, through the exam above it', async () => {
    const { service } = serviceWith(
      [
        makeExamStage({ id: 'stage_1', examId: 'exam_1' }),
        makeExamStage({ id: 'stage_2', examId: 'exam_2', stageKey: 'RRB_JE_CBT1' }),
      ],
      [
        makeExam(),
        makeExam({ id: 'exam_2', code: 'RRB JE', name: 'RRB JE', course: EXAM_COURSE.RRB }),
      ],
    );

    const page = await service.list(listQuery({ course: EXAM_COURSE.RRB }));

    assert.equal(page.total, 1);
    assert.equal(page.items[0]?.exam.code, 'RRB JE');
  });

  it('hides retired stages when the caller asks for active ones only', async () => {
    const { service } = serviceWith([
      makeExamStage({ id: 'stage_1' }),
      makeExamStage({ id: 'stage_2', stageKey: 'SSC_CGL_T2', isActive: false }),
    ]);

    assert.equal((await service.list(listQuery())).total, 2);
    assert.equal((await service.list(listQuery({ activeOnly: 'true' }))).total, 1);
  });
});

describe('ExamStagesService — creating', () => {
  it('creates a stage under an exam, defaulting mode and disposition', async () => {
    const { service, prisma } = serviceWith([]);

    const created = await service.create({
      examId: 'exam_1',
      stageKey: 'SSC_CGL_T2',
      name: 'Tier 2',
    });

    assert.equal(created.stageKey, 'SSC_CGL_T2');
    assert.equal(created.mode, EXAM_MODE.CBT);
    assert.equal(created.disposition, STAGE_DISPOSITION.CONDUCTED);
    assert.equal(prisma.examStages.length, 1);
  });

  /**
   * The key is what a seed script and the exam-pattern workbook address a stage by, and it is
   * unique table-wide — a second row carrying it would make "SSC_CGL_T1" mean two things.
   */
  it('refuses a stage key another exam already uses, against the key field', async () => {
    const { service } = serviceWith([makeExamStage({ stageKey: 'SSC_CGL_T1' })]);

    await assert.rejects(
      () => service.create({ examId: 'exam_1', stageKey: 'SSC_CGL_T1', name: 'Tier 1 again' }),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.CONFLICT);
        assert.ok(error.fieldErrors?.stageKey);
        return true;
      },
    );
  });

  it('refuses an exam that is not there, against the exam field', async () => {
    const { service } = serviceWith([], []);

    await assert.rejects(
      () => service.create({ examId: 'nope', stageKey: 'SSC_CGL_T1', name: 'Tier 1' }),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
        assert.ok(error.fieldErrors?.examId);
        return true;
      },
    );
  });
});

describe('ExamStagesService — updating', () => {
  it('renames a stage and reorders it', async () => {
    const { service } = serviceWith([makeExamStage({ id: 'stage_1' })]);

    const updated = await service.update('stage_1', { name: 'Prelims', order: 0 });

    assert.equal(updated.name, 'Prelims');
    assert.equal(updated.order, 0);
  });

  it('retires and reactivates one', async () => {
    const { service } = serviceWith([makeExamStage({ id: 'stage_1' })]);

    assert.equal((await service.update('stage_1', { isActive: false })).isActive, false);
    assert.equal((await service.update('stage_1', { isActive: true })).isActive, true);
  });

  it('changes the key while nothing hangs off it', async () => {
    const { service } = serviceWith([makeExamStage({ id: 'stage_1' })]);

    assert.equal(
      (await service.update('stage_1', { stageKey: 'SSC_CGL_P1' })).stageKey,
      'SSC_CGL_P1',
    );
  });

  /** Nothing links a base config back to the key, so a change would detach it silently. */
  it('refuses a key change once a base config hangs off the stage', async () => {
    const { service, prisma } = serviceWith([
      makeExamStage({ id: 'stage_1', _count: { baseConfigs: 2, tests: 0, series: 0 } }),
    ]);

    await assert.rejects(
      () => service.update('stage_1', { stageKey: 'SSC_CGL_P1' }),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.CONFLICT);
        assert.ok(error.fieldErrors?.stageKey);
        return true;
      },
    );
    assert.equal(prisma.examStages[0]?.stageKey, 'SSC_CGL_T1', 'nothing should have been written');
  });

  it('allows a PATCH that re-sends the key unchanged', async () => {
    const { service } = serviceWith([
      makeExamStage({ id: 'stage_1', _count: { baseConfigs: 2, tests: 0, series: 0 } }),
    ]);

    const updated = await service.update('stage_1', {
      stageKey: 'SSC_CGL_T1',
      disposition: STAGE_DISPOSITION.PARTIAL,
    });

    assert.equal(updated.disposition, STAGE_DISPOSITION.PARTIAL);
  });

  it('answers NOT_FOUND for a stage that is not there', async () => {
    const { service } = serviceWith([]);

    await assert.rejects(
      () => service.update('nope', { isActive: false }),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.NOT_FOUND);
        return true;
      },
    );
  });
});

describe('ExamStagesService — deleting', () => {
  it('deletes a stage nothing hangs off', async () => {
    const { service, prisma } = serviceWith([makeExamStage({ id: 'stage_1' })]);

    await service.remove('stage_1');

    assert.equal(prisma.examStages.length, 0);
  });

  /** A base config cascades to its sections, so this delete would take the blueprints with it. */
  it('refuses one that still carries base configs, tests or series, and names each', async () => {
    const { service, prisma } = serviceWith([
      makeExamStage({ id: 'stage_1', _count: { baseConfigs: 1, tests: 3, series: 2 } }),
    ]);

    await assert.rejects(
      () => service.remove('stage_1'),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.match(error.message, /1 base config\b/);
        assert.match(error.message, /3 tests/);
        assert.match(error.message, /2 series/);
        return true;
      },
    );
    assert.equal(prisma.examStages.length, 1, 'nothing should have been deleted');
  });
});

describe('ExamStagesService.assertUsable — the seam configs and tests come through', () => {
  it('accepts an active stage', async () => {
    const { service } = serviceWith([makeExamStage({ id: 'stage_1' })]);

    await assert.doesNotReject(() => service.assertUsable('stage_1'));
  });

  it('refuses a retired one, keyed to the field the caller names', async () => {
    const { service } = serviceWith([makeExamStage({ id: 'stage_1', isActive: false })]);

    const error = await service.assertUsable('stage_1', 'stageId').catch((e: unknown) => e);
    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(error.fieldErrors?.stageId?.[0]);
  });

  it('refuses one that is not there at all', async () => {
    const { service } = serviceWith([]);

    await assert.rejects(() => service.assertUsable('nope'), AppException.is);
  });

  /** CATALOG_ONLY exists so the journey reads whole on screen. Nobody sits it, so nothing is built on it. */
  it('refuses a stage that is listed for the journey only', async () => {
    const { service } = serviceWith([
      makeExamStage({ id: 'stage_1', disposition: STAGE_DISPOSITION.CATALOG_ONLY }),
    ]);

    const error = await service.assertUsable('stage_1').catch((e: unknown) => e);
    assert.ok(AppException.is(error));
    assert.match(error.message, /journey/);
  });

  it('accepts a partly-conducted stage, which does carry the objective paper', async () => {
    const { service } = serviceWith([
      makeExamStage({ id: 'stage_1', disposition: STAGE_DISPOSITION.PARTIAL }),
    ]);

    await assert.doesNotReject(() => service.assertUsable('stage_1'));
  });
});

/** The stage layer is the catalog too: reading is open to whoever picks from it, writing is not. */
describe('ExamStagesController — who may write', () => {
  const gatedOn = (handler: keyof ExamStagesController) =>
    Reflect.getMetadata(SUPER_ADMIN_KEY, ExamStagesController.prototype[handler]) === true;

  it('gates every write on being a super admin', () => {
    assert.equal(gatedOn('create'), true);
    assert.equal(gatedOn('update'), true);
    assert.equal(gatedOn('remove'), true);
  });

  it('leaves the list readable by anyone who manages students', () => {
    assert.equal(gatedOn('list'), false);
  });
});

describe('ExamStagesService — searching', () => {
  const exams = [
    makeExam({ id: 'exam_1', code: 'SSC CGL', name: 'SSC CGL' }),
    makeExam({ id: 'exam_2', code: 'SSC CHSL', name: 'SSC CHSL' }),
  ];
  const stages = [
    makeExamStage({ id: 'stage_1', examId: 'exam_1', stageKey: 'SSC_CGL_T1', name: 'Tier 1' }),
    makeExamStage({ id: 'stage_2', examId: 'exam_1', stageKey: 'SSC_CGL_T2', name: 'Tier 2' }),
    makeExamStage({ id: 'stage_3', examId: 'exam_2', stageKey: 'SSC_CHSL_T1', name: 'Tier 1' }),
  ];

  const found = async (q: string) => {
    const { service } = serviceWith(stages, exams);
    const page = await service.list(listQuery({ q }));
    return page.items.map((stage) => stage.id);
  };

  /** The picker labels a row by its exam's code, so the code has to be a thing you can type. */
  it('finds a stage by the exam code it is listed under', async () => {
    assert.deepEqual(await found('CHSL'), ['stage_3']);
  });

  /** The failure this prevents: the phrase an admin actually types matching nothing at all. */
  it('finds a stage by the exam and the tier together', async () => {
    assert.deepEqual(await found('SSC CGL Tier 2'), ['stage_2']);
  });

  it('finds a stage by the key seeds and the workbook address it by', async () => {
    assert.deepEqual(await found('SSC_CHSL_T1'), ['stage_3']);
  });

  /** Every word has to land somewhere, or the search is not narrowing anything. */
  it('finds nothing when one word matches no column', async () => {
    assert.deepEqual(await found('SSC CGL Tier 9'), []);
  });
});
