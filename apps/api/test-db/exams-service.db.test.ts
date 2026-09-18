import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import {
  AppException,
  EXAM_COURSE,
  ErrorCodes,
  examListQuerySchema,
  type ExamCourse,
  type ExamListQuery,
  type ExamListQueryInput,
} from '@iace/contracts';
import { AuditContext } from '../src/audit';
import { NotificationOutbox } from '../src/notifications/notification-outbox';
import { ExamsService } from '../src/configs/exams.service';
import { StudentsService } from '../src/students';
import { FakeEventBus, FakeQueue, fakeStartingPins } from '../test/support/fakes';
import { makeStudent, resetDatabase, testPrisma, uid } from './support/database';

/** One uuid per label, shared across the file so a test can name an id by what it means. */
const idCache = new Map<string, string>();
const idFor = (label: string): string => {
  const cached = idCache.get(label);
  if (cached) return cached;
  const id = randomUUID();
  idCache.set(label, id);
  return id;
};

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

interface ExamRow {
  id?: string;
  code?: string;
  name?: string;
  course?: ExamCourse;
  isActive?: boolean;
  stages?: number;
}

/** The exams given — SSC CGL unless told otherwise — each with as many stages as it names. */
async function serviceWith(exams: ExamRow[] = [{}]) {
  for (const { stages = 0, ...exam } of exams) {
    const row = await prisma.exam.create({
      data: {
        id: idFor('exam_1'),
        code: 'SSC CGL',
        name: 'SSC CGL',
        course: EXAM_COURSE.SSC,
        ...exam,
      },
    });
    for (let n = 0; n < stages; n += 1) {
      await prisma.examStage.create({
        data: { examId: row.id, stageKey: uid(), name: `Tier ${n + 1}` },
      });
    }
  }
  const students = new StudentsService(
    prisma,
    null as never,
    null as never,
    null as never,
    fakeStartingPins(),
    null as never,
    null as never,
    new FakeEventBus().asService(),
    new NotificationOutbox(new FakeQueue().asQueue()),
  );
  return new ExamsService(prisma, students, new AuditContext());
}

const listQuery = (over: Partial<ExamListQueryInput> = {}): ExamListQuery =>
  examListQuerySchema.parse({ page: '1', pageSize: '20', ...over });

const RRB_JE: ExamRow = {
  id: idFor('exam_2'),
  code: 'RRB JE',
  name: 'RRB JE',
  course: EXAM_COURSE.RRB,
};

const refusedWith = (code: string, field?: string) => (error: unknown) =>
  AppException.is(error) &&
  error.code === code &&
  (field === undefined || Boolean(error.fieldErrors?.[field]));

const enrolled = (...codes: string[][]) =>
  Promise.all(codes.map((enrolledExams) => makeStudent(prisma, { enrolledExams })));

describe('ExamsService — listing', () => {
  it('reports each exam with the number of stages hanging off it, dates as strings', async () => {
    const service = await serviceWith([
      { stages: 2 },
      { id: idFor('exam_2'), name: 'SSC CHSL', code: 'SSC CHSL' },
    ]);

    const page = await service.list(listQuery());

    const byCode = new Map(page.items.map((item) => [item.code, item.stageCount]));
    assert.equal(byCode.get('SSC CGL'), 2);
    assert.equal(byCode.get('SSC CHSL'), 0);
    assert.equal(page.total, 2);
    assert.equal(typeof page.items[0]?.createdAt, 'string');
  });

  it('hides retired exams when the caller asks for active ones only', async () => {
    const service = await serviceWith([
      {},
      { id: idFor('exam_2'), name: 'OLD', code: 'OLD', isActive: false },
    ]);

    assert.equal((await service.list(listQuery())).total, 2);
    assert.equal((await service.list(listQuery({ activeOnly: 'true' }))).total, 1);
  });

  it('narrows to one course, or any of the courses chosen', async () => {
    const service = await serviceWith([
      {},
      RRB_JE,
      { id: idFor('exam_3'), code: 'IBPS PO', name: 'IBPS PO', course: EXAM_COURSE.BANKING },
    ]);

    const one = await service.list(listQuery({ course: EXAM_COURSE.RRB }));
    const two = await service.list(listQuery({ course: [EXAM_COURSE.RRB, EXAM_COURSE.BANKING] }));

    assert.deepEqual(
      one.items.map((item) => item.code),
      ['RRB JE'],
    );
    assert.deepEqual(
      two.items.map((item) => item.code).sort((a, b) => a.localeCompare(b)),
      ['IBPS PO', 'RRB JE'],
    );
  });

  /** An emptied filter is "any course", so it must not narrow the list to nothing. */
  it('lists every exam when the course filter is emptied', async () => {
    const service = await serviceWith([{}, RRB_JE]);

    assert.equal((await service.list(listQuery({ course: [] }))).total, 2);
    assert.equal((await service.list(listQuery({ course: '' }))).total, 2);
  });
});

describe('ExamsService — creating', () => {
  it('creates an exam that does not exist yet', async () => {
    const service = await serviceWith([]);

    const created = await service.create({
      course: EXAM_COURSE.SSC,
      name: 'SSC CHSL',
      code: 'SSC CHSL',
    });

    assert.deepEqual([created.code, created.stageCount], ['SSC CHSL', 0]);
    assert.equal(await prisma.exam.count(), 1);
  });

  /** A CONFLICT the form shows against the field, keyed to `code` because every enrolment stores it. */
  it('refuses a duplicate code against the code field, and a duplicate name against the name field', async () => {
    const service = await serviceWith();

    await assert.rejects(
      () =>
        service.create({ course: EXAM_COURSE.SSC, name: 'Staff Selection CGL', code: 'SSC CGL' }),
      refusedWith(ErrorCodes.CONFLICT, 'code'),
    );
    await assert.rejects(
      () => service.create({ course: EXAM_COURSE.SSC, name: 'SSC CGL', code: 'SSC CGL TIER 1' }),
      (error: unknown) => AppException.is(error) && Boolean(error.fieldErrors?.name),
    );
  });
});

describe('ExamsService — updating', () => {
  it('renames an exam however many students are enrolled on it', async () => {
    const service = await serviceWith();
    await enrolled(['SSC CGL']);

    const updated = await service.update(idFor('exam_1'), { name: 'SSC Combined Graduate Level' });

    assert.deepEqual([updated.name, updated.code], ['SSC Combined Graduate Level', 'SSC CGL']);
  });

  it('retires and reactivates one, and changes the code while nothing references it', async () => {
    const service = await serviceWith();

    assert.equal((await service.update(idFor('exam_1'), { isActive: false })).isActive, false);
    assert.equal((await service.update(idFor('exam_1'), { isActive: true })).isActive, true);
    assert.equal(
      (await service.update(idFor('exam_1'), { code: 'SSC CGL T1' })).code,
      'SSC CGL T1',
    );
  });

  /** Nothing links an enrolment back to this row, so a code change would silently detach every one. */
  it('refuses a code change once a student is enrolled on the code, but takes the code re-sent unchanged', async () => {
    const service = await serviceWith();
    await enrolled(['SSC CGL']);

    await assert.rejects(
      () => service.update(idFor('exam_1'), { code: 'SSC CGL T1' }),
      refusedWith(ErrorCodes.CONFLICT, 'code'),
    );
    assert.equal(
      (await prisma.exam.findUniqueOrThrow({ where: { id: idFor('exam_1') } })).code,
      'SSC CGL',
    );
    assert.equal(
      (await service.update(idFor('exam_1'), { code: 'SSC CGL', isActive: false })).isActive,
      false,
    );
  });

  it('answers NOT_FOUND for an exam that is not there', async () => {
    const service = await serviceWith([]);

    await assert.rejects(
      () => service.update(randomUUID(), { isActive: false }),
      refusedWith(ErrorCodes.NOT_FOUND),
    );
  });
});

describe('ExamsService — deleting', () => {
  it('deletes an exam nothing depends on', async () => {
    const service = await serviceWith();

    await service.remove(idFor('exam_1'));

    assert.equal(await prisma.exam.count(), 0);
  });

  /** A stage carries the configs, series and tests built on it — one delete would take them all. */
  it('refuses one that still has stages, and says how many', async () => {
    const service = await serviceWith([{ stages: 1 }]);

    await assert.rejects(() => service.remove(idFor('exam_1')), /1 stage\b/);
    assert.equal(await prisma.exam.count(), 1, 'nothing should have been deleted');
  });

  it('refuses one students are enrolled on, even with no stages', async () => {
    const service = await serviceWith();
    await enrolled(['SSC CGL'], ['SSC CGL']);

    await assert.rejects(() => service.remove(idFor('exam_1')), /2 enrolled students/);
  });
});

describe('ExamsService.assertUsable — the seam students come through', () => {
  it('accepts active codes, and an empty list', async () => {
    const service = await serviceWith();

    await assert.doesNotReject(() => service.assertUsable(['SSC CGL'], 'enrolledExams'));
    await assert.doesNotReject(() => service.assertUsable([], 'enrolledExams'));
  });

  /** The field key is a parameter: `applyFieldErrors` drops a key the receiving form does not own. */
  it('keys its refusal to the field the caller names', async () => {
    const service = await serviceWith([{ isActive: false }]);

    const error = await service.assertUsable(['SSC CGL'], 'enrolledExams').catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(error.fieldErrors?.enrolledExams?.[0]);
    assert.equal(error.fieldErrors?.examCode, undefined);
  });

  it('names the codes it could not find', async () => {
    const service = await serviceWith();

    await assert.rejects(
      () => service.assertUsable(['SSC CGL', 'RRB JE'], 'enrolledExams'),
      /RRB JE/,
    );
  });
});
