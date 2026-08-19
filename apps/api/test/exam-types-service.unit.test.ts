import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AppException,
  ErrorCodes,
  examTypeListQuerySchema,
  type ExamTypeListQuery,
  type ExamTypeListQueryInput,
} from '@iace/contracts';
import { ExamTypesController } from '../src/configs/exam-types.controller';
import { ExamTypesService } from '../src/configs/exam-types.service';
import { SUPER_ADMIN_KEY } from '../src/common/security';
import { GroupsService } from '../src/groups';
import { StudentsService } from '../src/students';
import { AuditContext } from '../src/audit';
import { type FakeExamType, FakePrisma, makeExamType, makeGroup } from './support/fakes';

/** The catalog, exercised through the service rather than its rule helpers. */
function serviceWith(examTypes: FakeExamType[] = [makeExamType()], groups = [makeGroup()]) {
  const prisma = new FakePrisma([], [], [], groups, examTypes);
  const service = new ExamTypesService(
    prisma.asService(),
    new GroupsService(prisma.asService(), null as never, null as never, new AuditContext()),
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

const listQuery = (over: Partial<ExamTypeListQueryInput> = {}): ExamTypeListQuery =>
  examTypeListQuerySchema.parse({ page: '1', pageSize: '20', ...over });

describe('ExamTypesService — listing', () => {
  it('reports one grouped count per distinct code, not the same number for every row', async () => {
    const { service } = serviceWith(
      [
        makeExamType({ id: 'ext_1', name: 'SSC CGL', code: 'SSC CGL' }),
        makeExamType({ id: 'ext_2', name: 'SSC CHSL', code: 'SSC CHSL' }),
      ],
      [
        makeGroup({ id: 'grp_1', examType: 'SSC CGL' }),
        makeGroup({ id: 'grp_2', examType: 'SSC CGL' }),
      ],
    );

    const page = await service.list(listQuery());

    const byCode = new Map(page.items.map((item) => [item.code, item.groupCount]));
    assert.equal(byCode.get('SSC CGL'), 2);
    assert.equal(byCode.get('SSC CHSL'), 0);
    assert.equal(page.total, 2);
  });

  it('hides retired types when the caller asks for active ones only', async () => {
    const { service } = serviceWith(
      [
        makeExamType({ id: 'ext_1' }),
        makeExamType({ id: 'ext_2', name: 'OLD', code: 'OLD', isActive: false }),
      ],
      [],
    );

    assert.equal((await service.list(listQuery())).total, 2);
    assert.equal((await service.list(listQuery({ activeOnly: 'true' }))).total, 1);
  });

  it('returns dates as strings, never Date objects', async () => {
    const { service } = serviceWith();

    assert.equal(typeof (await service.list(listQuery())).items[0]?.createdAt, 'string');
  });
});

describe('ExamTypesService — creating', () => {
  it('creates an exam type that does not exist yet', async () => {
    const { service, prisma } = serviceWith([], []);

    const created = await service.create({ name: 'SSC CHSL', code: 'SSC CHSL' });

    assert.equal(created.code, 'SSC CHSL');
    assert.equal(created.groupCount, 0);
    assert.equal(prisma.examTypes.length, 1);
  });

  /**
   * A CONFLICT the form can show against the field, not a 500 from the unique index — and keyed to
   * `code`, because that is the value every group and enrolment will store.
   */
  it('refuses a duplicate code, against the code field', async () => {
    const { service } = serviceWith([makeExamType({ name: 'SSC CGL', code: 'SSC CGL' })]);

    await assert.rejects(
      () => service.create({ name: 'Staff Selection CGL', code: 'SSC CGL' }),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.CONFLICT);
        assert.ok(error.fieldErrors?.code);
        return true;
      },
    );
  });

  it('refuses a duplicate name, against the name field', async () => {
    const { service } = serviceWith([makeExamType({ name: 'SSC CGL', code: 'SSC CGL' })]);

    await assert.rejects(
      () => service.create({ name: 'SSC CGL', code: 'SSC CGL TIER 1' }),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.ok(error.fieldErrors?.name);
        return true;
      },
    );
  });
});

describe('ExamTypesService — updating', () => {
  it('renames an exam type however much is attached to it', async () => {
    const { service } = serviceWith(
      [makeExamType({ id: 'ext_1', name: 'SSC CGL', code: 'SSC CGL' })],
      [makeGroup({ id: 'grp_1', examType: 'SSC CGL' })],
    );

    const updated = await service.update('ext_1', { name: 'SSC Combined Graduate Level' });

    assert.equal(updated.name, 'SSC Combined Graduate Level');
    assert.equal(updated.code, 'SSC CGL');
  });

  it('retires and reactivates one', async () => {
    const { service } = serviceWith([makeExamType({ id: 'ext_1' })], []);

    assert.equal((await service.update('ext_1', { isActive: false })).isActive, false);
    assert.equal((await service.update('ext_1', { isActive: true })).isActive, true);
  });

  it('changes the code while nothing references it', async () => {
    const { service } = serviceWith([makeExamType({ id: 'ext_1', code: 'SSC CGL' })], []);

    assert.equal((await service.update('ext_1', { code: 'SSC CGL T1' })).code, 'SSC CGL T1');
  });

  /**
   * The failure the edit blocker exists to prevent: nothing links a group back to this row, so a
   * code change is a silent detach of every group and every enrolment.
   */
  it('refuses a code change once a group carries the code', async () => {
    const { service, prisma } = serviceWith(
      [makeExamType({ id: 'ext_1', code: 'SSC CGL' })],
      [makeGroup({ id: 'grp_1', examType: 'SSC CGL' })],
    );

    await assert.rejects(
      () => service.update('ext_1', { code: 'SSC CGL T1' }),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.CONFLICT);
        assert.ok(error.fieldErrors?.code);
        return true;
      },
    );
    assert.equal(prisma.examTypes[0]?.code, 'SSC CGL', 'nothing should have been written');
  });

  it('allows a PATCH that re-sends the code unchanged', async () => {
    const { service } = serviceWith(
      [makeExamType({ id: 'ext_1', code: 'SSC CGL' })],
      [makeGroup({ id: 'grp_1', examType: 'SSC CGL' })],
    );

    assert.equal(
      (await service.update('ext_1', { code: 'SSC CGL', isActive: false })).isActive,
      false,
    );
  });

  it('answers NOT_FOUND for an exam type that is not there', async () => {
    const { service } = serviceWith([], []);

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

describe('ExamTypesService — deleting', () => {
  it('deletes an exam type nothing depends on', async () => {
    const { service, prisma } = serviceWith([makeExamType({ id: 'ext_1' })], []);

    await service.remove('ext_1');

    assert.equal(prisma.examTypes.length, 0);
  });

  it('refuses one that still has groups, and says how many', async () => {
    const { service, prisma } = serviceWith(
      [makeExamType({ id: 'ext_1', code: 'SSC CGL' })],
      [makeGroup({ id: 'grp_1', examType: 'SSC CGL' })],
    );

    await assert.rejects(
      () => service.remove('ext_1'),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.match(error.message, /1 group\b/);
        return true;
      },
    );
    assert.equal(prisma.examTypes.length, 1, 'nothing should have been deleted');
  });

  /** `BaseConfig.examTypeId` CASCADEs, so this delete would take every blueprint with it. */
  it('refuses one that still has base configs, even with no groups', async () => {
    const { service, prisma } = serviceWith([makeExamType({ id: 'ext_1' })], []);
    prisma.baseConfigCount = 3;

    await assert.rejects(
      () => service.remove('ext_1'),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.match(error.message, /3 base configs/);
        return true;
      },
    );
  });
});

describe('ExamTypesService.assertUsable — the seam groups and students come through', () => {
  it('accepts active codes', async () => {
    const { service } = serviceWith([makeExamType({ code: 'SSC CGL' })], []);

    await assert.doesNotReject(() => service.assertUsable(['SSC CGL'], 'examType'));
    await assert.doesNotReject(() => service.assertUsable([], 'enrolledExams'));
  });

  /** The field key is a parameter: `applyFieldErrors` drops a key the receiving form does not own. */
  it('keys its refusal to the field the caller names', async () => {
    const { service } = serviceWith([makeExamType({ code: 'SSC CGL', isActive: false })], []);

    const error = await service.assertUsable(['SSC CGL'], 'enrolledExams').catch((e: unknown) => e);
    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(error.fieldErrors?.enrolledExams?.[0]);
    assert.equal(error.fieldErrors?.examType, undefined);
  });

  it('names the codes it could not find', async () => {
    const { service } = serviceWith([makeExamType({ code: 'SSC CGL' })], []);

    const error = await service
      .assertUsable(['SSC CGL', 'RRB JE'], 'examType')
      .catch((e: unknown) => e);
    assert.ok(AppException.is(error));
    assert.match(error.message, /RRB JE/);
  });
});

/**
 * The catalog every group and enrolment validates against is not something a page permission may
 * invent — reading it is open to whoever manages groups, writing it is not.
 */
describe('ExamTypesController — who may write', () => {
  const gatedOn = (handler: keyof ExamTypesController) =>
    Reflect.getMetadata(SUPER_ADMIN_KEY, ExamTypesController.prototype[handler]) === true;

  it('gates every write on being a super admin', () => {
    assert.equal(gatedOn('create'), true);
    assert.equal(gatedOn('update'), true);
    assert.equal(gatedOn('remove'), true);
  });

  it('leaves the list readable by anyone who manages groups', () => {
    assert.equal(gatedOn('list'), false);
  });
});
