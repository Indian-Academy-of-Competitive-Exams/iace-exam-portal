import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AppException,
  ErrorCodes,
  MERIT_TYPE,
  TIMER_TEMPLATE,
  type CreateBaseConfigBody,
} from '@iace/contracts';
import { BaseConfigsService } from '../src/configs/base-configs.service';
import { ExamStagesService } from '../src/configs/exam-stages.service';
import { AuditContext } from '../src/audit';
import {
  type FakeBaseConfigRow,
  type FakeSectionRow,
  FakeConfigPrisma,
  makeBaseConfig,
  makeExamStage,
  makeSection,
} from './support/fakes';

const ADMIN = 'adm_1';

function serviceWith(configs: FakeBaseConfigRow[] = [], sections: FakeSectionRow[] = []) {
  const prisma = new FakeConfigPrisma(
    configs,
    sections,
    [],
    [makeExamStage({ id: 'stage_1' }), makeExamStage({ id: 'stage_2', stageKey: 'SSC_CGL_T2' })],
  );
  const stages = new ExamStagesService(prisma.asService(), new AuditContext());
  return {
    prisma,
    service: new BaseConfigsService(prisma.asService(), stages, new AuditContext()),
  };
}

/** The SSC CGL Tier 1 shape, in the form the editor posts. */
function draft(over: Partial<CreateBaseConfigBody> = {}): CreateBaseConfigBody {
  return {
    examStageId: 'stage_1',
    name: 'SSC CGL Tier 1',
    durationSec: 3600,
    sections: [
      {
        name: 'General Intelligence',
        order: 1,
        questionCount: 25,
        marksPerQuestion: 2,
        negativeMarks: 0.5,
      },
      {
        name: 'Quantitative Aptitude',
        order: 2,
        questionCount: 25,
        marksPerQuestion: 2,
        negativeMarks: 0.5,
      },
    ],
    ...over,
  } as CreateBaseConfigBody;
}

describe('BaseConfigsService — creating', () => {
  it('writes the sections and caches the totals they add up to', async () => {
    const { service, prisma } = serviceWith();

    const created = await service.create(draft(), ADMIN);

    assert.equal(created.sections.length, 2);
    assert.equal(created.totalQuestions, 50);
    assert.equal(created.totalMarks, 100);
    assert.equal(prisma.sections.length, 2);
  });

  it('carries per-section marks, negative marks and merit type', async () => {
    const { service } = serviceWith();

    const created = await service.create(
      draft({
        sections: [
          {
            name: 'English',
            order: 1,
            questionCount: 25,
            marksPerQuestion: 2,
            negativeMarks: 0.5,
            meritOrQualifying: MERIT_TYPE.QUALIFYING,
            qualifyingCutoff: 20,
          },
        ],
      }),
      ADMIN,
    );

    const [section] = created.sections;
    assert.equal(section?.marksPerQuestion, 2);
    assert.equal(section?.negativeMarks, 0.5);
    assert.equal(section?.meritOrQualifying, MERIT_TYPE.QUALIFYING);
    assert.equal(section?.qualifyingCutoff, 20);
  });

  /**
   * The rule the database also holds as a deferred trigger. Checked here so the admin gets a
   * sentence against the sections rather than a Postgres exception at commit.
   */
  /** The bug this catches: a seeded paper ran 160 minutes over sections that add up to 180. */
  it('refuses a sectional paper whose sections do not add up to its own clock', async () => {
    const { service } = serviceWith();
    const timed = draft({
      timerTemplate: TIMER_TEMPLATE.SECTIONAL_LOCKED,
      durationSec: 3600,
      sections: [
        { name: 'One', order: 1, questionCount: 25, marksPerQuestion: 2, durationSec: 1200 },
        { name: 'Two', order: 2, questionCount: 25, marksPerQuestion: 2, durationSec: 1200 },
      ],
    } as Partial<CreateBaseConfigBody>);

    await assert.rejects(
      () => service.create(timed, ADMIN),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.match(error.message, /40 minutes.*60 minutes/);
        return true;
      },
    );
  });

  it('takes a sectional paper whose sections add up', async () => {
    const { service } = serviceWith();

    const created = await service.create(
      draft({
        timerTemplate: TIMER_TEMPLATE.SECTIONAL_LOCKED,
        durationSec: 2400,
        sections: [
          { name: 'One', order: 1, questionCount: 25, marksPerQuestion: 2, durationSec: 1200 },
          { name: 'Two', order: 2, questionCount: 25, marksPerQuestion: 2, durationSec: 1200 },
        ],
      } as Partial<CreateBaseConfigBody>),
      ADMIN,
    );

    assert.equal(created.durationSec, 2400);
  });

  it('refuses a sectional paper whose sections have no clock', async () => {
    const { service } = serviceWith();

    await assert.rejects(
      () => service.create(draft({ timerTemplate: TIMER_TEMPLATE.SECTIONAL_LOCKED }), ADMIN),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
        assert.ok(error.fieldErrors?.sections);
        return true;
      },
    );
  });

  it('refuses two sections sitting at the same position', async () => {
    const { service } = serviceWith();

    await assert.rejects(
      () =>
        service.create(
          draft({
            sections: [
              { name: 'A', order: 1, questionCount: 5, marksPerQuestion: 1, negativeMarks: 0 },
              { name: 'B', order: 1, questionCount: 5, marksPerQuestion: 1, negativeMarks: 0 },
            ],
          }),
          ADMIN,
        ),
      AppException.is,
    );
  });

  it('refuses a stage that is retired', async () => {
    const prisma = new FakeConfigPrisma(
      [],
      [],
      [],
      [makeExamStage({ id: 'stage_1', isActive: false })],
    );
    const stages = new ExamStagesService(prisma.asService(), new AuditContext());
    const service = new BaseConfigsService(prisma.asService(), stages, new AuditContext());

    await assert.rejects(() => service.create(draft(), ADMIN), AppException.is);
  });
});

describe('BaseConfigsService — one default per stage', () => {
  /**
   * A stage holds ONE official pattern; a partial unique index says so. The two writes share a
   * transaction, or promoting a clone collides with the original it is replacing.
   */
  it('clears the previous default on the stage when a new one is promoted', async () => {
    const { service, prisma } = serviceWith([
      makeBaseConfig({ id: 'cfg_1', examStageId: 'stage_1', isDefault: true }),
    ]);

    await service.create(draft({ isDefault: true }), ADMIN);

    const defaults = prisma.configs.filter(
      (config) => config.examStageId === 'stage_1' && config.isDefault,
    );
    assert.equal(defaults.length, 1, 'a stage holds exactly one default');
    assert.notEqual(defaults[0]?.id, 'cfg_1', 'the new one is the default now');
  });

  it('leaves another stage’s default alone', async () => {
    const { service, prisma } = serviceWith([
      makeBaseConfig({ id: 'cfg_other', examStageId: 'stage_2', isDefault: true }),
    ]);

    await service.create(draft({ isDefault: true }), ADMIN);

    assert.equal(prisma.configs.find((config) => config.id === 'cfg_other')?.isDefault, true);
  });

  it('promotes an existing config over the current default', async () => {
    const { service, prisma } = serviceWith([
      makeBaseConfig({ id: 'cfg_1', isDefault: true }),
      makeBaseConfig({ id: 'cfg_2', isDefault: false }),
    ]);

    await service.update('cfg_2', { isDefault: true });

    assert.equal(prisma.configs.find((config) => config.id === 'cfg_1')?.isDefault, false);
    assert.equal(prisma.configs.find((config) => config.id === 'cfg_2')?.isDefault, true);
  });
});

describe('BaseConfigsService — editing an unlocked config', () => {
  /** The totals are a cache. An edit that changes the sections and leaves them stale would put
   *  a number on the screen that the paper does not add up to. */
  it('recomputes the cached totals when the sections change', async () => {
    const { service, prisma } = serviceWith();
    const created = await service.create(draft(), ADMIN);

    const edited = await service.update(created.id, {
      sections: [
        {
          name: 'One section only',
          order: 1,
          questionCount: 10,
          marksPerQuestion: 3,
          negativeMarks: 1,
        },
      ],
    });

    assert.equal(edited.totalQuestions, 10);
    assert.equal(edited.totalMarks, 30);
    assert.equal(prisma.sections.length, 1, 'the replaced sections are gone, not orphaned');
  });

  /**
   * The failure this prevents: switching the timer alone leaves the sections in a shape the new
   * template forbids, and the database refuses it with a raw exception nobody can act on.
   */
  it('judges a timer change against the sections already stored', async () => {
    const { service } = serviceWith();
    const created = await service.create(draft(), ADMIN);

    await assert.rejects(
      () => service.update(created.id, { timerTemplate: TIMER_TEMPLATE.SECTIONAL_LOCKED }),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
        return true;
      },
    );
  });
});

describe('BaseConfigsService — a locked config', () => {
  /**
   * THE rule this exists for: `locked` trips at the first finalize, which is the moment a paper
   * froze against the shape. Changing it afterwards rewrites the rules an already-sat test was
   * scored under.
   */
  it('refuses every shape change, and says to clone it', async () => {
    const { service, prisma } = serviceWith([makeBaseConfig({ id: 'cfg_1', locked: true })]);

    await assert.rejects(
      () => service.update('cfg_1', { durationSec: 7200 }),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.CONFLICT);
        assert.match(error.message, /[Cc]lone/);
        return true;
      },
    );
    assert.equal(prisma.configs[0]?.durationSec, 3600, 'nothing should have been written');
  });

  it('refuses a section rewrite too — the sections ARE the shape', async () => {
    const { service } = serviceWith(
      [makeBaseConfig({ id: 'cfg_1', locked: true })],
      [makeSection({ id: 'sec_1', baseConfigId: 'cfg_1' })],
    );

    await assert.rejects(
      () => service.update('cfg_1', { sections: draft().sections }),
      AppException.is,
    );
  });

  /**
   * Not a loophole: a stage holds one default, so promoting a clone means first clearing
   * `isDefault` on the locked original. Freezing these three would deadlock the stage.
   */
  it('still renames, retires and hands over its default', async () => {
    const { service, prisma } = serviceWith([
      makeBaseConfig({ id: 'cfg_1', locked: true, isDefault: true }),
    ]);

    await service.update('cfg_1', { name: 'Tier 1 (2025 pattern)', isDefault: false });

    assert.equal(prisma.configs[0]?.name, 'Tier 1 (2025 pattern)');
    assert.equal(prisma.configs[0]?.isDefault, false);
  });

  it('cannot be deleted — a test built from it has already been sat', async () => {
    const { service } = serviceWith([makeBaseConfig({ id: 'cfg_1', locked: true })]);

    await assert.rejects(() => service.remove('cfg_1'), AppException.is);
  });
});

describe('BaseConfigsService — a session paper', () => {
  const sessionDraft = draft({
    timerTemplate: TIMER_TEMPLATE.SESSION_MODULE_LOCKED,
    modules: [
      { name: 'Session 1', order: 1, durationSec: 3600 },
      { name: 'Session 2', order: 2, durationSec: 3600 },
    ],
    sections: [
      {
        name: 'General Intelligence',
        order: 1,
        moduleOrder: 1,
        questionCount: 25,
        marksPerQuestion: 2,
        negativeMarks: 0.5,
      },
      {
        name: 'English',
        order: 2,
        moduleOrder: 2,
        questionCount: 25,
        marksPerQuestion: 2,
        negativeMarks: 0.5,
      },
    ],
  });

  /** The section names its module BY ORDER: the modules are new rows, so a draft has no id. */
  it('puts each section in the module it named, not in the first one', async () => {
    const { service } = serviceWith();

    const created = await service.create(sessionDraft, ADMIN);

    const [first, second] = created.sections;
    const modules = new Map(created.modules.map((module) => [module.id, module.name]));
    assert.equal(modules.get(first?.moduleId ?? ''), 'Session 1');
    assert.equal(modules.get(second?.moduleId ?? ''), 'Session 2');
  });

  it('refuses a session paper with no modules at all', async () => {
    const { service } = serviceWith();

    await assert.rejects(
      () =>
        service.create(
          draft({ timerTemplate: TIMER_TEMPLATE.SESSION_MODULE_LOCKED, modules: [] }),
          ADMIN,
        ),
      AppException.is,
    );
  });

  it('refuses modules on a paper that is not a session one', async () => {
    const { service } = serviceWith();

    await assert.rejects(
      () => service.create(draft({ modules: [{ name: 'Session 1', order: 1 }] }), ADMIN),
      AppException.is,
    );
  });
});

describe('BaseConfigsService — clone to evolve', () => {
  it('copies the whole paper, unlocked, pointing back at what it came from', async () => {
    const { service } = serviceWith(
      [makeBaseConfig({ id: 'cfg_1', locked: true, version: 1 })],
      [
        makeSection({ id: 'sec_1', baseConfigId: 'cfg_1', name: 'A', order: 1 }),
        makeSection({ id: 'sec_2', baseConfigId: 'cfg_1', name: 'B', order: 2 }),
      ],
    );

    const clone = await service.clone('cfg_1', {}, ADMIN);

    assert.equal(clone.clonedFromId, 'cfg_1');
    assert.equal(clone.version, 2);
    assert.equal(clone.locked, false);
    assert.equal(clone.isDefault, false, 'a clone is never born the default');
    assert.deepEqual(
      clone.sections.map((section) => section.name),
      ['A', 'B'],
    );
  });

  /** The point of cloning: the copy is editable where the original is not. */
  it('accepts the shape change the locked original refused', async () => {
    const { service } = serviceWith(
      [makeBaseConfig({ id: 'cfg_1', locked: true })],
      [makeSection({ id: 'sec_1', baseConfigId: 'cfg_1' })],
    );

    const clone = await service.clone('cfg_1', { name: 'Tier 1 v2' }, ADMIN);
    const edited = await service.update(clone.id, { durationSec: 7200 });

    assert.equal(edited.durationSec, 7200);
  });

  it('leaves the original untouched', async () => {
    const { service, prisma } = serviceWith(
      [makeBaseConfig({ id: 'cfg_1', locked: true, durationSec: 3600 })],
      [makeSection({ id: 'sec_1', baseConfigId: 'cfg_1' })],
    );

    const clone = await service.clone('cfg_1', {}, ADMIN);
    await service.update(clone.id, { durationSec: 7200 });

    assert.equal(prisma.configs.find((config) => config.id === 'cfg_1')?.durationSec, 3600);
  });
});
