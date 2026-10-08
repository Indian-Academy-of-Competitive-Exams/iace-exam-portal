import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  AppException,
  ErrorCodes,
  MERIT_TYPE,
  TIMER_TEMPLATE,
  type BaseConfigDetail,
  type BaseConfigSectionDraft,
  type CreateBaseConfigBody,
} from '@iace/contracts';
import { BaseConfigsService } from '../src/configs/base-configs.service';
import { ExamStagesService } from '../src/configs/exam-stages.service';
import { AuditContext } from '../src/audit';
import { EDIT_LOCK_TTL_SEC } from '../src/redis/redis.keys';
import { type Editor } from '../src/common/edit-lock';
import { DOMAIN_EVENTS } from '../src/common/events';
import { FakeEventBus, FakeRedis } from '../test/support/fakes';
import {
  makeAdmin,
  makePaper,
  makeStage,
  resetDatabase,
  testPrisma,
  uid,
} from './support/database';

const ADMIN = uid();

const prisma = testPrisma();
const redis = new FakeRedis();
const events = new FakeEventBus();
const service = new BaseConfigsService(
  prisma,
  new ExamStagesService(prisma, new AuditContext(), events.asService()),
  new AuditContext(),
  redis.asService(),
  events.asService(),
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

/** The editor's own save: the whole stored paper posted back, with one column of its first section changed. */
async function editFirstSection(
  id: string,
  over: Partial<BaseConfigSectionDraft>,
): Promise<BaseConfigDetail['sections'][number]> {
  const before = await service.detail(id);
  const edited = await service.update(id, {
    sections: before.sections.map((section, index) => ({
      name: section.name,
      order: section.order,
      questionCount: section.questionCount,
      marksPerQuestion: section.marksPerQuestion,
      negativeMarks: section.negativeMarks,
      patternNote: section.patternNote,
      perQuestionSec: section.perQuestionSec,
      mandatory: section.mandatory,
      meritOrQualifying: section.meritOrQualifying,
      qualifyingCutoff: section.qualifyingCutoff,
      ...(index === 0 ? over : {}),
    })),
  });
  const [first] = edited.sections;
  assert.ok(first, 'the paper still holds its first section');
  return first;
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

describe('base_config_guard — what the database refuses on a locked config', () => {
  /** The bug this prevents: a paper somebody has already sat being re-skinned by a script or a psql session, which the service layer refuses but the trigger used to let through. */
  it('refuses a skin change, the same as every other shape column', async () => {
    const id = await seedConfig({ examStageId: await makeStage(prisma), locked: true });

    await assert.rejects(
      prisma.$executeRaw`UPDATE "BaseConfig" SET "examTemplate" = 'SSC_RAILWAYS' WHERE "id" = ${id}::uuid`,
      /locked; clone it to change its shape/,
    );
    assert.equal((await configRow(id)).examTemplate, 'DEFAULT');
  });

  /** Name, isDefault and isActive stay editable by design — freezing them would deadlock a stage on whichever config locked first. */
  it('still takes a rename', async () => {
    const id = await seedConfig({ examStageId: await makeStage(prisma), locked: true });

    await prisma.$executeRaw`UPDATE "BaseConfig" SET "name" = 'Renamed' WHERE "id" = ${id}::uuid`;

    assert.equal((await configRow(id)).name, 'Renamed');
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

  /** The failure this prevents: a column the change check did not know about, so an edit touching only that column was dropped while the save still reported success. */
  it('writes a save that changes one section column and leaves the rest alone', async () => {
    const created = await service.create(draft(await makeStage(prisma)), ADMIN);

    assert.equal((await editFirstSection(created.id, { perQuestionSec: 45 })).perQuestionSec, 45);
    assert.equal((await editFirstSection(created.id, { mandatory: false })).mandatory, false);
    const qualifying = await editFirstSection(created.id, {
      meritOrQualifying: MERIT_TYPE.QUALIFYING,
      qualifyingCutoff: 12,
    });
    assert.equal(qualifying.meritOrQualifying, MERIT_TYPE.QUALIFYING);
    assert.equal(qualifying.qualifyingCutoff, 12);
    assert.equal(qualifying.perQuestionSec, 45, 'the earlier columns are still on the row');
  });

  /** THE loss: the paper is replaced wholesale on save, so a note the mapper did not carry was deleted by an edit that touched something else entirely. */
  it("keeps a section's pattern note through a save that changes a different column", async () => {
    const created = await service.create(draft(await makeStage(prisma)), ADMIN);
    const noted = await editFirstSection(created.id, { patternNote: 'Moderate-Difficult' });
    assert.equal(noted.patternNote, 'Moderate-Difficult');

    const after = await editFirstSection(created.id, { questionCount: 30 });

    assert.equal(after.questionCount, 30);
    assert.equal(
      after.patternNote,
      'Moderate-Difficult',
      'the workbook words survived the rewrite',
    );
  });

  it('clears a pattern note when the editor empties it', async () => {
    const created = await service.create(draft(await makeStage(prisma)), ADMIN);
    await editFirstSection(created.id, { patternNote: 'Moderate-Difficult' });

    assert.equal((await editFirstSection(created.id, { patternNote: null })).patternNote, null);
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

describe('BaseConfigsService — a config a test is built on', () => {
  /** The failure this prevents: a 500 from a paper row's foreign key, or a draft whose sections vanish under it. */
  it('refuses a section rewrite, with a paper on it or not yet, and says to clone it', async () => {
    for (const questions of [[], ['Reasoning']]) {
      await resetDatabase(prisma);
      const paper = await makePaper(prisma, { questions });
      const configId = paper.catalog.baseConfigId;

      await assert.rejects(
        () => service.update(configId, { sections: draft(paper.catalog.examStageId).sections }),
        (error: unknown) =>
          AppException.is(error) &&
          error.code === ErrorCodes.CONFLICT &&
          /[Cc]lone/.test(error.message),
      );
      const kept = await prisma.baseConfigSection.findMany({
        where: { baseConfigId: configId },
        select: { id: true },
      });
      assert.deepEqual(
        kept.map((section) => section.id),
        paper.sectionIds,
      );
    }
  });

  /** The editor posts the whole paper on every save, renumbered from zero, so a rename carries it back unchanged. */
  it('takes a rename that posts back the paper it already holds', async () => {
    const paper = await makePaper(prisma, {
      sections: ['Reasoning', 'Quant'],
      questions: ['Reasoning'],
    });
    const configId = paper.catalog.baseConfigId;
    const stored = await prisma.baseConfigSection.findMany({
      where: { baseConfigId: configId },
      orderBy: { order: 'asc' },
    });

    await service.update(configId, {
      name: 'Tier 1 (drafts)',
      sections: stored.map((section, index) => ({
        name: section.name,
        order: index,
        subjectId: section.subjectId,
        questionCount: section.questionCount,
        marksPerQuestion: Number(section.marksPerQuestion),
        negativeMarks: Number(section.negativeMarks),
        durationSec: section.durationSec,
        perQuestionSec: section.perQuestionSec,
        mandatory: section.mandatory,
        meritOrQualifying: section.meritOrQualifying,
        qualifyingCutoff: null,
      })),
    });

    assert.equal((await configRow(configId)).name, 'Tier 1 (drafts)');
    const kept = await prisma.baseConfigSection.findMany({
      where: { baseConfigId: configId },
      orderBy: { order: 'asc' },
      select: { id: true },
    });
    assert.deepEqual(
      kept.map((section) => section.id),
      paper.sectionIds,
    );
  });

  /** The failure this prevents: an offered test's brief still showing a duration its config no longer has. */
  it('tells the catalog about an edit to a config a test is built on', async () => {
    const { catalog } = await makePaper(prisma, { questions: [] });
    events.forget();

    await service.update(catalog.baseConfigId, { durationSec: 5400 });

    assert.deepEqual(events.of(DOMAIN_EVENTS.EXAM_STAGE_CHANGED), [
      { examStageId: catalog.examStageId },
    ]);
  });
});

describe('BaseConfigsService — a session paper', () => {
  const sessionDraft = (examStageId: string) =>
    draft(examStageId, {
      timerTemplate: TIMER_TEMPLATE.SESSION_MODULE_LOCKED,
      modules: [
        { name: 'Session 1', order: 1, durationSec: 1800 },
        { name: 'Session 2', order: 2, durationSec: 1800 },
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

  /** The bug this catches: two 60-minute sessions saved onto a paper that only runs for 60. */
  it('refuses a session paper whose modules run past its own clock', async () => {
    const overrun = draft(await makeStage(prisma), {
      timerTemplate: TIMER_TEMPLATE.SESSION_MODULE_LOCKED,
      durationSec: 3600,
      modules: [
        { name: 'Session 1', order: 1, durationSec: 3600 },
        { name: 'Session 2', order: 2, durationSec: 3600 },
      ],
    });

    await assert.rejects(
      () => service.create(overrun, ADMIN),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
        assert.match(error.message, /120 minutes.*60 minutes/);
        return true;
      },
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

  /** The failure this prevents: a clone of the official pattern losing the workbook's own words. */
  it('carries the pattern notes across', async () => {
    const original = await seedConfig({ examStageId: await makeStage(prisma), sections: ['A'] });
    await prisma.baseConfigSection.updateMany({
      where: { baseConfigId: original },
      data: { patternNote: 'Part A — 25 questions, 2 marks each' },
    });

    const clone = await service.clone(original, {}, ADMIN);

    const copied = await prisma.baseConfigSection.findMany({ where: { baseConfigId: clone.id } });
    assert.equal(copied[0]?.patternNote, 'Part A — 25 questions, 2 marks each');
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

describe('BaseConfigsService — deleting a config others were cloned from', () => {
  /** The failure this prevents: the lineage foreign key refusing the delete, and the admin reading a generic "still in use". */
  it('refuses while a clone points back at it, saying how many, and deletes one nothing points at', async () => {
    const original = await seedConfig({ examStageId: await makeStage(prisma), sections: ['A'] });
    const clone = await service.clone(original, {}, ADMIN);

    await assert.rejects(
      () => service.remove(original),
      (error: unknown) =>
        AppException.is(error) &&
        error.code === ErrorCodes.CONFLICT &&
        /1 config was cloned from this one/.test(error.message),
    );
    assert.ok(await prisma.baseConfig.findUnique({ where: { id: original } }));

    await service.remove(clone.id);
    await service.remove(original);
    assert.equal(await prisma.baseConfig.count(), 0);
  });
});

const refused = async (attempt: Promise<unknown>) => {
  const error = await attempt.catch((caught: unknown) => caught);
  assert.ok(AppException.is(error));
  return error;
};

const sectionNames = async (baseConfigId: string) =>
  (
    await prisma.baseConfigSection.findMany({
      where: { baseConfigId },
      orderBy: { order: 'asc' },
      select: { name: true },
    })
  ).map((section) => section.name);

/** One section per name, in the shape an editor posts — the whole paper, never a delta. */
const sectionsNamed = (names: readonly string[]) =>
  names.map((name, index) => ({
    name,
    order: index,
    questionCount: 25,
    marksPerQuestion: 2,
    negativeMarks: 0.5,
  }));

const save = (id: string, names: readonly string[], expectedUpdatedAt: string, editor?: Editor) =>
  service.update(
    id,
    { durationSec: 3600, sections: sectionsNamed(names), expectedUpdatedAt },
    editor,
  );

describe('BaseConfigsService — two admins on one configuration', () => {
  /** THE data loss: B's stale paper deleting the section A had just added, with no conflict shown. */
  it('refuses the stale save, and the section the first admin added is still there', async () => {
    const opened = await service.create(draft(await makeStage(prisma)), ADMIN);
    const priya = await makeAdmin(prisma, { fullName: 'Priya' });
    const ravi = await makeAdmin(prisma, { fullName: 'Ravi' });

    const added = await save(opened.id, ['A', 'B', 'C'], opened.updatedAt, { id: priya.id });
    redis.advanceSeconds(EDIT_LOCK_TTL_SEC + 1);

    const error = await refused(save(opened.id, ['A', 'B'], opened.updatedAt, { id: ravi.id }));

    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.match(error.message, /changed this configuration/);
    assert.deepEqual(await sectionNames(opened.id), ['A', 'B', 'C']);
    assert.equal(added.totalQuestions, 75);
  });

  it('leaves the configuration exactly as it was when a race is lost', async () => {
    const opened = await service.create(draft(await makeStage(prisma)), ADMIN);
    await save(opened.id, ['A', 'B', 'C'], opened.updatedAt);
    const won = await configRow(opened.id);

    await refused(
      service.update(opened.id, {
        name: 'Renamed by the loser',
        durationSec: 7200,
        sections: sectionsNamed(['A']),
        expectedUpdatedAt: opened.updatedAt,
      }),
    );

    assert.deepEqual(await configRow(opened.id), won);
  });

  it('accepts the save that carries back what it opened', async () => {
    const opened = await service.create(draft(await makeStage(prisma)), ADMIN);

    const saved = await save(opened.id, ['A', 'B', 'C'], opened.updatedAt);

    assert.deepEqual(await sectionNames(opened.id), ['A', 'B', 'C']);
    assert.notEqual(saved.updatedAt, opened.updatedAt);
  });

  it('refuses the second admin by name before the work, not at the save', async () => {
    const opened = await service.create(draft(await makeStage(prisma)), ADMIN);
    const priya = await makeAdmin(prisma, { fullName: 'Priya' });
    const ravi = await makeAdmin(prisma, { fullName: 'Ravi' });

    const held = await save(opened.id, ['A', 'B'], opened.updatedAt, { id: priya.id });
    const error = await refused(save(opened.id, ['C'], held.updatedAt, { id: ravi.id }));

    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.match(error.message, /Priya is editing this configuration/);
    assert.deepEqual(await sectionNames(opened.id), ['A', 'B']);
    assert.equal((await service.detail(opened.id)).editingBy?.fullName, 'Priya');
  });

  it('lets the admin holding it carry on', async () => {
    const opened = await service.create(draft(await makeStage(prisma)), ADMIN);
    const priya = await makeAdmin(prisma, { fullName: 'Priya' });

    const first = await save(opened.id, ['A', 'B'], opened.updatedAt, { id: priya.id });
    await save(opened.id, ['A', 'B', 'C'], first.updatedAt, { id: priya.id });

    assert.deepEqual(await sectionNames(opened.id), ['A', 'B', 'C']);
  });

  /** An admin who closed their laptop holding it is the lockout the override exists for. */
  it('hands it to a super admin, and refuses the first admin after', async () => {
    const opened = await service.create(draft(await makeStage(prisma)), ADMIN);
    const priya = await makeAdmin(prisma, { fullName: 'Priya' });
    const ravi = await makeAdmin(prisma, { fullName: 'Ravi', isSuperAdmin: true });

    const held = await save(opened.id, ['A', 'B'], opened.updatedAt, { id: priya.id });
    const stolen = await save(opened.id, ['A', 'B', 'C'], held.updatedAt, {
      id: ravi.id,
      isSuperAdmin: true,
    });

    assert.deepEqual(await sectionNames(opened.id), ['A', 'B', 'C']);
    const error = await refused(save(opened.id, ['A'], stolen.updatedAt, { id: priya.id }));
    assert.match(error.message, /Ravi is editing this configuration/);
  });

  /** Deleting is a shape change nothing undoes, so it waits on whoever is mid-edit too. */
  it('refuses a delete while another admin is editing', async () => {
    const opened = await service.create(draft(await makeStage(prisma)), ADMIN);
    const priya = await makeAdmin(prisma, { fullName: 'Priya' });
    const ravi = await makeAdmin(prisma, { fullName: 'Ravi' });

    await save(opened.id, ['A', 'B'], opened.updatedAt, { id: priya.id });
    const error = await refused(service.remove(opened.id, { id: ravi.id }));

    assert.match(error.message, /Priya is editing this configuration/);
    assert.ok(await prisma.baseConfig.findUnique({ where: { id: opened.id } }));
  });
});
