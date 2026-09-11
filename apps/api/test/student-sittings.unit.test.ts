import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { studentSittingsQuerySchema } from '@iace/contracts';
import { StudentsService } from '../src/students/students.service';
import { AuditContext } from '../src/audit';
import { type BranchesService } from '../src/branches/branches.service';
import { type ExamsService } from '../src/configs';
import { type StorageService } from '../src/storage/storage.service';
import {
  fakeNotificationOutbox,
  fakeStartingPins,
  FakeCodeCatalog,
  FakeEventBus,
  FakePrisma,
  makeReportSitting,
  type FakeReportSitting,
} from './support/fakes';

function build(sittings: FakeReportSitting[]) {
  const prisma = new FakePrisma();
  prisma.reportSittings.push(...sittings);
  const service = new StudentsService(
    prisma.asService(),
    {} as StorageService,
    {} as ExamsService,
    {} as BranchesService,
    fakeStartingPins(),
    new FakeCodeCatalog().asService(),
    new AuditContext(),
    new FakeEventBus().asService(),
    fakeNotificationOutbox(),
  );
  return service;
}

const query = (raw: Record<string, string>) => studentSittingsQuerySchema.parse(raw);

describe('StudentsService.sittings — the admin report picker', () => {
  it('narrows to the tests whose title matches, in any case, and names whether each holds the ranked slot', async () => {
    const service = build([
      makeReportSitting({ id: 'att_mock', title: 'SSC CGL Mock 3' }),
      makeReportSitting({ id: 'att_retake', title: 'SSC CGL Mock 3', isGraded: false }),
      makeReportSitting({ id: 'att_quant', title: 'Quant sectional' }),
      makeReportSitting({ id: 'att_theirs', studentId: 'stu_2', title: 'SSC CGL Mock 3' }),
    ]);

    const page = await service.sittings('stu_1', query({ q: 'MOCK' }));

    assert.deepEqual(page.items.map((row) => [row.attemptId, row.isGraded]).toSorted(), [
      ['att_mock', true],
      ['att_retake', false],
    ]);
    assert.equal(page.total, 2);
  });

  it('keeps an untitled test in the list while the search box is blank', async () => {
    const service = build([
      makeReportSitting({ id: 'att_titled' }),
      makeReportSitting({ id: 'att_untitled', title: null }),
    ]);

    const page = await service.sittings('stu_1', query({ q: '   ' }));

    assert.deepEqual(page.items.map((row) => row.attemptId).toSorted(), [
      'att_titled',
      'att_untitled',
    ]);
  });
});
