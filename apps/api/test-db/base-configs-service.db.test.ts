import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
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
import { makeStage, resetDatabase, testPrisma, uid } from './support/database';

const ADMIN = uid();

const prisma = testPrisma();
const service = new BaseConfigsService(
  prisma,
  new ExamStagesService(prisma, new AuditContext()),
  new AuditContext(),
);

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

interface ConfigSeed {
  examStageId: string;
  isDefault?: boolean;
  locked?: boolean;
  version?: number;
  sections?: string[];
}

/** A stored config. Locked last, because the section guard refuses a section written into a locked one. */
async function seedConfig(seed: ConfigSeed): Promise<string> {
  const config = await prisma.baseConfig.create({
    data: {
      examStageId: seed.examStageId,
      name: 'SSC CGL Tier 1 — official pattern',
      isDefault: seed.isDefault ?? false,
      version: seed.version ?? 1,
      totalQuestions: 100,
      totalMarks: 200,
      durationSec: 3600,
    },
    select: { id: true },
  });
  for (const [index, name] of (seed.sections ?? []).entries()) {
    await prisma.baseConfigSection.create({
      data: {
        baseConfigId: config.id,
        name,
        order: index + 1,
        questionCount: 25,
        marksPerQuestion: 2,
        negativeMarks: 0.5,
      },
    });
  }
  if (seed.locked) {
    await prisma.baseConfig.update({ where: { id: config.id }, data: { locked: true } });
  }
  return config.id;
}

const configRow = (id: string) => prisma.baseConfig.findUniqueOrThrow({ where: { id } });

/** The SSC CGL Tier 1 shape, in the form the editor posts. */
function draft(
  examStageId: string,
  over: Partial<CreateBaseConfigBody> = {},
): CreateBaseConfigBody {
  return {
    examStageId,
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
    const created = await service.create(draft(await makeStage(prisma)), ADMIN);

    assert.equal(created.sections.length, 2);
    assert.equal(created.totalQuestions, 50);
    assert.equal(created.totalMarks, 100);
    assert.equal(await prisma.baseConfigSection.count({ where: { baseConfigId: created.id } }), 2);
  });

  it('carries per-section marks, negative marks and merit type', async () => {
    const created = await service.create(
      draft(await makeStage(prisma), {
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

  /** The bug this catches: a seeded paper ran 160 minutes over sections that add up to 180. */
  it('refuses a sectional paper whose sections do not add up to its own clock', async () => {
    const timed = draft(await makeStage(prisma), {
      timerTemplate: TIMER_TEMPLATE.SECTIONAL_LOCKED,
      durationSec: 3600,
      sections: [
        {
          name: 'One',
          order: 1,
          questionCount: 25,
          marksPerQuestion: 2,
          negativeMarks: 0,
          durationSec: 1200,
        },
        {
          name: 'Two',
          order: 2,
          questionCount: 25,
          marksPerQuestion: 2,
          negativeMarks: 0,
          durationSec: 1200,
        },
      ],
    });

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
    const created = await service.create(
      draft(await makeStage(prisma), {
        timerTemplate: TIMER_TEMPLATE.SECTIONAL_LOCKED,
        durationSec: 2400,
        sections: [
          {
            name: 'One',
            order: 1,
            questionCount: 25,
            marksPerQuestion: 2,
            negativeMarks: 0,
            durationSec: 1200,
          },
          {
            name: 'Two',
            order: 2,
            questionCount: 25,
            marksPerQuestion: 2,
            negativeMarks: 0,
            durationSec: 1200,
          },
        ],
      }),
      ADMIN,
    );

    assert.equal(created.durationSec, 2400);
  });

  it('refuses a sectional paper whose sections have no clock', async () => {
    const stageId = await makeStage(prisma);

    await assert.rejects(
      () =>
        service.create(draft(stageId, { timerTemplate: TIMER_TEMPLATE.SECTIONAL_LOCKED }), ADMIN),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
        assert.ok(error.fieldErrors?.sections);
        return true;
      },
    );
  });

  it('refuses two sections sitting at the same position', async () => {
    const stageId = await makeStage(prisma);

    await assert.rejects(
      () =>
        service.create(
          draft(stageId, {
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
    const retired = await makeStage(prisma, false);

    await assert.rejects(() => service.create(draft(retired), ADMIN), AppException.is);
  });
});

describe('BaseConfigsService — one default per stage', () => {
  /** A partial unique index holds one official pattern per stage, so the two writes share a transaction. */
  it('clears the previous default on the stage when a new one is promoted', async () => {
    const stageId = await makeStage(prisma);
    const original = await seedConfig({ examStageId: stageId, isDefault: true });

    const promoted = await service.create(draft(stageId, { isDefault: true }), ADMIN);

    const defaults = await prisma.baseConfig.findMany({
      where: { examStageId: stageId, isDefault: true },
    });
    assert.equal(defaults.length, 1, 'a stage holds exactly one default');
    assert.equal(defaults[0]?.id, promoted.id, 'the new one is the default now');
    assert.notEqual(defaults[0]?.id, original);
  });

  it('leaves another stage’s default alone', async () => {
    const other = await seedConfig({ examStageId: await makeStage(prisma), isDefault: true });

    await service.create(draft(await makeStage(prisma), { isDefault: true }), ADMIN);

    assert.equal((await configRow(other)).isDefault, true);
  });

  it('promotes an existing config over the current default', async () => {
    const stageId = await makeStage(prisma);
    const current = await seedConfig({ examStageId: stageId, isDefault: true });
    const challenger = await seedConfig({ examStageId: stageId });

    await service.update(challenger, { isDefault: true });

    assert.equal((await configRow(current)).isDefault, false);
    assert.equal((await configRow(challenger)).isDefault, true);
  });
});

describe('BaseConfigsService — editing an unlocked config', () => {
  /** The totals are a cache, so an edit that leaves them stale puts a number on screen the paper is not. */
  it('recomputes the cached totals when the sections change', async () => {
    const created = await service.create(draft(await makeStage(prisma)), ADMIN);

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
    assert.equal(
      await prisma.baseConfigSection.count({ where: { baseConfigId: created.id } }),
      1,
      'the replaced sections are gone, not orphaned',
    );
  });

  /** Switching the timer alone leaves sections the new template forbids, which Postgres would refuse raw. */
  it('judges a timer change against the sections already stored', async () => {
    const created = await service.create(draft(await makeStage(prisma)), ADMIN);

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
  /** Locked at the first finalize: changing it afterwards rewrites the rules a sat test was scored under. */
  it('refuses every shape change, and says to clone it', async () => {
    const locked = await seedConfig({ examStageId: await makeStage(prisma), locked: true });

    await assert.rejects(
      () => service.update(locked, { durationSec: 7200 }),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.CONFLICT);
        assert.match(error.message, /[Cc]lone/);
        return true;
      },
    );
    assert.equal((await configRow(locked)).durationSec, 3600, 'nothing should have been written');
  });

  it('refuses a section rewrite too — the sections ARE the shape', async () => {
    const stageId = await makeStage(prisma);
    const locked = await seedConfig({ examStageId: stageId, locked: true, sections: ['A'] });

    await assert.rejects(
      () => service.update(locked, { sections: draft(stageId).sections }),
      AppException.is,
    );
  });

  /** Not a loophole: promoting a clone first clears `isDefault` on the locked original. */
  it('still renames, retires and hands over its default', async () => {
    const locked = await seedConfig({
      examStageId: await makeStage(prisma),
      locked: true,
      isDefault: true,
    });

    await service.update(locked, { name: 'Tier 1 (2025 pattern)', isDefault: false });

    const row = await configRow(locked);
    assert.equal(row.name, 'Tier 1 (2025 pattern)');
    assert.equal(row.isDefault, false);
  });

  it('cannot be deleted — a test built from it has already been sat', async () => {
    const locked = await seedConfig({ examStageId: await makeStage(prisma), locked: true });

    await assert.rejects(() => service.remove(locked), AppException.is);
  });
});

describe('BaseConfigsService — a session paper', () => {
  const sessionDraft = (examStageId: string) =>
    draft(examStageId, {
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
    const created = await service.create(sessionDraft(await makeStage(prisma)), ADMIN);

    const [first, second] = created.sections;
    const modules = new Map(created.modules.map((module) => [module.id, module.name]));
    assert.equal(modules.get(first?.moduleId ?? ''), 'Session 1');
    assert.equal(modules.get(second?.moduleId ?? ''), 'Session 2');
  });

  it('refuses a session paper with no modules at all', async () => {
    const stageId = await makeStage(prisma);

    await assert.rejects(
      () =>
        service.create(
          draft(stageId, { timerTemplate: TIMER_TEMPLATE.SESSION_MODULE_LOCKED, modules: [] }),
          ADMIN,
        ),
      AppException.is,
    );
  });

  it('refuses modules on a paper that is not a session one', async () => {
    const stageId = await makeStage(prisma);

    await assert.rejects(
      () => service.create(draft(stageId, { modules: [{ name: 'Session 1', order: 1 }] }), ADMIN),
      AppException.is,
    );
  });
});

describe('BaseConfigsService — clone to evolve', () => {
  it('copies the whole paper, unlocked, pointing back at what it came from', async () => {
    const original = await seedConfig({
      examStageId: await makeStage(prisma),
      locked: true,
      isDefault: true,
      sections: ['A', 'B'],
    });

    const clone = await service.clone(original, {}, ADMIN);

    assert.equal(clone.clonedFromId, original);
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
    const original = await seedConfig({
      examStageId: await makeStage(prisma),
      locked: true,
      sections: ['A'],
    });

    const clone = await service.clone(original, { name: 'Tier 1 v2' }, ADMIN);
    const edited = await service.update(clone.id, { durationSec: 7200 });

    assert.equal(edited.durationSec, 7200);
  });

  it('leaves the original untouched', async () => {
    const original = await seedConfig({
      examStageId: await makeStage(prisma),
      locked: true,
      sections: ['A'],
    });

    const clone = await service.clone(original, {}, ADMIN);
    await service.update(clone.id, { durationSec: 7200 });

    assert.equal((await configRow(original)).durationSec, 3600);
  });
});
