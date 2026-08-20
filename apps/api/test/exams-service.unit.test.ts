import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AppException,
  ErrorCodes,
  EXAM_FAMILY,
  examListQuerySchema,
  type ExamListQuery,
  type ExamListQueryInput,
} from '@iace/contracts';
import { ExamsController } from '../src/configs/exams.controller';
import { ExamsService } from '../src/configs/exams.service';
import { SUPER_ADMIN_KEY } from '../src/common/security';
import { StudentsService } from '../src/students';
import { AuditContext } from '../src/audit';
import {
  type FakeExam,
  type FakeStudent,
  FakePrisma,
  makeExam,
  makeStudent,
} from './support/fakes';

/** The catalog, exercised through the service rather than its rule helpers. */
function serviceWith(exams: FakeExam[] = [makeExam()], students: FakeStudent[] = []) {
  const prisma = new FakePrisma(students, [], [], exams);
  const service = new ExamsService(
    prisma.asService(),
    new StudentsService(
      prisma.asService(),
      null as never,
      null as never,
      null as never,
      null as never,
    ),
    new AuditContext(),
  );
  return { service, prisma };
}

const listQuery = (over: Partial<ExamListQueryInput> = {}): ExamListQuery =>
  examListQuerySchema.parse({ page: '1', pageSize: '20', ...over });

describe('ExamsService — listing', () => {
  it('reports each exam with the number of stages hanging off it', async () => {
    const { service } = serviceWith([
      makeExam({ id: 'exam_1', name: 'SSC CGL', code: 'SSC CGL', _count: { stages: 2 } }),
      makeExam({ id: 'exam_2', name: 'SSC CHSL', code: 'SSC CHSL' }),
    ]);

    const page = await service.list(listQuery());

    const byCode = new Map(page.items.map((item) => [item.code, item.stageCount]));
    assert.equal(byCode.get('SSC CGL'), 2);
    assert.equal(byCode.get('SSC CHSL'), 0);
    assert.equal(page.total, 2);
  });

  it('hides retired exams when the caller asks for active ones only', async () => {
    const { service } = serviceWith([
      makeExam({ id: 'exam_1' }),
      makeExam({ id: 'exam_2', name: 'OLD', code: 'OLD', isActive: false }),
    ]);

    assert.equal((await service.list(listQuery())).total, 2);
    assert.equal((await service.list(listQuery({ activeOnly: 'true' }))).total, 1);
  });

  it('narrows to one family', async () => {
    const { service } = serviceWith([
      makeExam({ id: 'exam_1', family: EXAM_FAMILY.SSC }),
      makeExam({ id: 'exam_2', code: 'RRB JE', name: 'RRB JE', family: EXAM_FAMILY.RRB }),
    ]);

    const page = await service.list(listQuery({ family: EXAM_FAMILY.RRB }));

    assert.equal(page.total, 1);
    assert.equal(page.items[0]?.code, 'RRB JE');
  });

  it('returns dates as strings, never Date objects', async () => {
    const { service } = serviceWith();

    assert.equal(typeof (await service.list(listQuery())).items[0]?.createdAt, 'string');
  });
});

describe('ExamsService — creating', () => {
  it('creates an exam that does not exist yet', async () => {
    const { service, prisma } = serviceWith([]);

    const created = await service.create({
      family: EXAM_FAMILY.SSC,
      name: 'SSC CHSL',
      code: 'SSC CHSL',
    });

    assert.equal(created.code, 'SSC CHSL');
    assert.equal(created.stageCount, 0);
    assert.equal(prisma.exams.length, 1);
  });

  /**
   * A CONFLICT the form can show against the field, not a 500 from the unique index — and keyed to
   * `code`, because that is the value every enrolment will store.
   */
  it('refuses a duplicate code, against the code field', async () => {
    const { service } = serviceWith([makeExam({ name: 'SSC CGL', code: 'SSC CGL' })]);

    await assert.rejects(
      () =>
        service.create({ family: EXAM_FAMILY.SSC, name: 'Staff Selection CGL', code: 'SSC CGL' }),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.CONFLICT);
        assert.ok(error.fieldErrors?.code);
        return true;
      },
    );
  });

  it('refuses a duplicate name, against the name field', async () => {
    const { service } = serviceWith([makeExam({ name: 'SSC CGL', code: 'SSC CGL' })]);

    await assert.rejects(
      () => service.create({ family: EXAM_FAMILY.SSC, name: 'SSC CGL', code: 'SSC CGL TIER 1' }),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.ok(error.fieldErrors?.name);
        return true;
      },
    );
  });
});

describe('ExamsService — updating', () => {
  it('renames an exam however many students are enrolled on it', async () => {
    const { service } = serviceWith(
      [makeExam({ id: 'exam_1', name: 'SSC CGL', code: 'SSC CGL' })],
      [makeStudent({ enrolledExams: ['SSC CGL'] })],
    );

    const updated = await service.update('exam_1', { name: 'SSC Combined Graduate Level' });

    assert.equal(updated.name, 'SSC Combined Graduate Level');
    assert.equal(updated.code, 'SSC CGL');
  });

  it('retires and reactivates one', async () => {
    const { service } = serviceWith([makeExam({ id: 'exam_1' })]);

    assert.equal((await service.update('exam_1', { isActive: false })).isActive, false);
    assert.equal((await service.update('exam_1', { isActive: true })).isActive, true);
  });

  it('changes the code while nothing references it', async () => {
    const { service } = serviceWith([makeExam({ id: 'exam_1', code: 'SSC CGL' })]);

    assert.equal((await service.update('exam_1', { code: 'SSC CGL T1' })).code, 'SSC CGL T1');
  });

  /**
   * The failure the edit blocker exists to prevent: nothing links an enrolment back to this row,
   * so a code change is a silent detach of every one of them.
   */
  it('refuses a code change once a student is enrolled on the code', async () => {
    const { service, prisma } = serviceWith(
      [makeExam({ id: 'exam_1', code: 'SSC CGL' })],
      [makeStudent({ enrolledExams: ['SSC CGL'] })],
    );

    await assert.rejects(
      () => service.update('exam_1', { code: 'SSC CGL T1' }),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.CONFLICT);
        assert.ok(error.fieldErrors?.code);
        return true;
      },
    );
    assert.equal(prisma.exams[0]?.code, 'SSC CGL', 'nothing should have been written');
  });

  it('allows a PATCH that re-sends the code unchanged', async () => {
    const { service } = serviceWith(
      [makeExam({ id: 'exam_1', code: 'SSC CGL' })],
      [makeStudent({ enrolledExams: ['SSC CGL'] })],
    );

    assert.equal(
      (await service.update('exam_1', { code: 'SSC CGL', isActive: false })).isActive,
      false,
    );
  });

  it('answers NOT_FOUND for an exam that is not there', async () => {
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

describe('ExamsService — deleting', () => {
  it('deletes an exam nothing depends on', async () => {
    const { service, prisma } = serviceWith([makeExam({ id: 'exam_1' })]);

    await service.remove('exam_1');

    assert.equal(prisma.exams.length, 0);
  });

  /** A stage carries the configs, series and tests built on it — one delete would take them all. */
  it('refuses one that still has stages, and says how many', async () => {
    const { service, prisma } = serviceWith([makeExam({ id: 'exam_1', _count: { stages: 1 } })]);

    await assert.rejects(
      () => service.remove('exam_1'),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.match(error.message, /1 stage\b/);
        return true;
      },
    );
    assert.equal(prisma.exams.length, 1, 'nothing should have been deleted');
  });

  it('refuses one students are enrolled on, even with no stages', async () => {
    const { service } = serviceWith(
      [makeExam({ id: 'exam_1', code: 'SSC CGL' })],
      [
        makeStudent({ id: 'stu_1', enrolledExams: ['SSC CGL'] }),
        makeStudent({ id: 'stu_2', enrolledExams: ['SSC CGL'] }),
      ],
    );

    await assert.rejects(
      () => service.remove('exam_1'),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.match(error.message, /2 enrolled students/);
        return true;
      },
    );
  });
});

describe('ExamsService.assertUsable — the seam students come through', () => {
  it('accepts active codes', async () => {
    const { service } = serviceWith([makeExam({ code: 'SSC CGL' })]);

    await assert.doesNotReject(() => service.assertUsable(['SSC CGL'], 'enrolledExams'));
    await assert.doesNotReject(() => service.assertUsable([], 'enrolledExams'));
  });

  /** The field key is a parameter: `applyFieldErrors` drops a key the receiving form does not own. */
  it('keys its refusal to the field the caller names', async () => {
    const { service } = serviceWith([makeExam({ code: 'SSC CGL', isActive: false })]);

    const error = await service.assertUsable(['SSC CGL'], 'enrolledExams').catch((e: unknown) => e);
    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(error.fieldErrors?.enrolledExams?.[0]);
    assert.equal(error.fieldErrors?.examCode, undefined);
  });

  it('names the codes it could not find', async () => {
    const { service } = serviceWith([makeExam({ code: 'SSC CGL' })]);

    const error = await service
      .assertUsable(['SSC CGL', 'RRB JE'], 'enrolledExams')
      .catch((e: unknown) => e);
    assert.ok(AppException.is(error));
    assert.match(error.message, /RRB JE/);
  });
});

/**
 * The catalog every enrolment validates against is not something a page permission may invent —
 * reading it is open to whoever manages students, writing it is not.
 */
describe('ExamsController — who may write', () => {
  const gatedOn = (handler: keyof ExamsController) =>
    Reflect.getMetadata(SUPER_ADMIN_KEY, ExamsController.prototype[handler]) === true;

  it('gates every write on being a super admin', () => {
    assert.equal(gatedOn('create'), true);
    assert.equal(gatedOn('update'), true);
    assert.equal(gatedOn('remove'), true);
  });

  it('leaves the list readable by anyone who manages students', () => {
    assert.equal(gatedOn('list'), false);
  });
});
