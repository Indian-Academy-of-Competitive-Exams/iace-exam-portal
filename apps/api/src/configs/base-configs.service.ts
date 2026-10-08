import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  EXAM_TEMPLATE,
  MERIT_TYPE,
  TEST_UI,
  TIMER_TEMPLATE,
  configTotalsOf,
  fieldDiff,
  type BaseConfig,
  type BaseConfigDetail,
  type BaseConfigListQuery,
  type ExamTemplate,
  type MeritType,
  type TestUi,
  type BaseConfigModuleDraft,
  type BaseConfigSectionDraft,
  type CloneBaseConfigBody,
  type CreateBaseConfigBody,
  type EditLockHolder,
  type Paginated,
  type TimerTemplate,
  type UpdateBaseConfigBody,
} from '@iace/contracts';
import { PrismaService, TX_LIMITS } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { redisKeys } from '../redis/redis.keys';
import {
  EDIT_SUBJECTS,
  editLockHeldBy,
  editedElsewhere,
  takeEditLock,
  type Editor,
} from '../common/edit-lock';
import { AuditContext } from '../audit';
import { DomainEventBus, DOMAIN_EVENTS } from '../common/events';
import { ExamStagesService } from './exam-stages.service';
import {
  configDeletionBlocker,
  configShapeIssues,
  renderModeIssue,
  INACTIVE_CONFIG_MESSAGE,
  locksOutEdit,
  BUILT_ON_CONFIG_MESSAGE,
  LOCKED_CONFIG_MESSAGE,
} from './base-config-rules';
import { formRefusal } from '../common/form-refusal';
import { pageArgs, paged } from '../common/pagination';
import { everyTermMatches } from '../common/search-terms';

const CONFIG_INCLUDE = {
  examStage: {
    select: {
      id: true,
      stageKey: true,
      name: true,
      exam: { select: { id: true, code: true, name: true, course: true } },
    },
  },
  _count: { select: { tests: true } },
} as const satisfies Prisma.BaseConfigInclude;

const DETAIL_INCLUDE = {
  ...CONFIG_INCLUDE,
  modules: { orderBy: { order: 'asc' } },
  sections: { orderBy: { order: 'asc' } },
} as const satisfies Prisma.BaseConfigInclude;

type ConfigRow = Prisma.BaseConfigGetPayload<{ include: typeof CONFIG_INCLUDE }>;
type DetailRow = Prisma.BaseConfigGetPayload<{ include: typeof DETAIL_INCLUDE }>;

/** What a config's audit diff covers. The shape is frozen once locked — see `UNFROZEN_FIELDS`. */
export const AUDITED_CONFIG_FIELDS = [
  'name',
  'isDefault',
  'isActive',
  'durationSec',
  'timerTemplate',
  'navigation',
  'totalQuestions',
] as const;

/** Owns `BaseConfig`, `BaseConfigModule` and `BaseConfigSection` — a stage's blueprint. A test inherits its shape rather than restating it, so the config freezes when the first paper does. */
@Injectable()
export class BaseConfigsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stages: ExamStagesService,
    private readonly auditContext: AuditContext,
    private readonly redis: RedisService,
    private readonly events: DomainEventBus,
  ) {}

  async list(query: BaseConfigListQuery): Promise<Paginated<BaseConfig>> {
    const where: Prisma.BaseConfigWhereInput = {
      ...everyTermMatches<Prisma.BaseConfigWhereInput>(query.q, (term) => [
        { name: { contains: term, mode: 'insensitive' } },
      ]),
      ...(query.examStageId ? { examStageId: query.examStageId } : {}),
      ...(query.examId ? { examStage: { examId: { in: query.examId } } } : {}),
      ...(query.defaultOnly ? { isDefault: true } : {}),
      ...(query.activeOnly ? { isActive: true } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.baseConfig.findMany({
        where,
        include: CONFIG_INCLUDE,
        // The stage's own pattern first, then the customs built from it.
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        ...pageArgs(query),
      }),
      this.prisma.baseConfig.count({ where }),
    ]);

    return paged(query, rows.map(toConfig), total);
  }

  async detail(id: string): Promise<BaseConfigDetail> {
    return toDetail(await this.requireDetail(id), await this.editingBy(id));
  }

  async create(input: CreateBaseConfigBody, createdById: string): Promise<BaseConfigDetail> {
    await this.stages.assertUsable(input.examStageId);

    const timerTemplate = input.timerTemplate ?? TIMER_TEMPLATE.COMPOSITE_FREE;
    const modules = input.modules ?? [];
    this.assertShape(timerTemplate, input.sections, modules, input.durationSec);
    this.assertRenderMode(
      input.examTemplate ?? EXAM_TEMPLATE.DEFAULT,
      input.defaultTestUi ?? TEST_UI.CBT,
    );

    const id = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) await clearDefault(tx, input.examStageId, null);

      const config = await tx.baseConfig.create({
        data: {
          examStageId: input.examStageId,
          name: input.name,
          isDefault: input.isDefault ?? false,
          createdById,
          ...shapeColumnsOf(input, timerTemplate),
          durationSec: input.durationSec,
          ...configTotalsOf(input.sections),
        },
      });

      await writeChildren(tx, config.id, paperRowsOf(timerTemplate, input.sections, modules));
      return config.id;
    }, TX_LIMITS.SHORT);

    return this.detail(id);
  }

  /** A locked config refuses every shape change here rather than at the database's trigger, so the admin reads a sentence instead of a Postgres exception. Name, default and active still move — that is what lets a clone be promoted over the locked original it replaces. */
  async update(
    id: string,
    input: UpdateBaseConfigBody,
    editor: Editor = {},
  ): Promise<BaseConfigDetail> {
    const config = await this.requireDetail(id);

    if (config.locked && locksOutEdit(input)) {
      throw formRefusal(ErrorCodes.CONFLICT, LOCKED_CONFIG_MESSAGE);
    }
    assertScreenIsCurrent(config, input.expectedUpdatedAt);

    const timerTemplate = input.timerTemplate ?? (config.timerTemplate as TimerTemplate);
    const sections = input.sections;
    const modules = input.modules ?? (input.sections ? [] : undefined);
    // The editor posts the whole paper on every save, so only a paper that differs is rewritten.
    const posted =
      sections === undefined ? null : paperRowsOf(timerTemplate, sections, modules ?? []);
    const rewritten =
      posted !== null && paperKeyOf(posted) !== paperKeyOf(storedPaperRows(config)) ? posted : null;
    // A test's paper rows, assignments, scope and draw spec all name these sections by id, and a rewrite mints new ones.
    if (rewritten && config._count.tests > 0) {
      throw formRefusal(ErrorCodes.CONFLICT, BUILT_ON_CONFIG_MESSAGE);
    }
    // Judged against what the config WILL hold: switching the timer alone can leave the sections in a shape the new template forbids, and the database would refuse that with a raw error.
    this.assertShape(
      timerTemplate,
      sections ?? config.sections.map(toSectionDraft),
      modules ?? config.modules,
      input.durationSec ?? config.durationSec,
    );
    this.assertRenderMode(
      input.examTemplate ?? (config.examTemplate as ExamTemplate),
      input.defaultTestUi ?? (config.defaultTestUi as TestUi),
    );

    await this.claimEdit(id, editor);

    await this.prisma.$transaction(async (tx) => {
      // FIRST, and conditional: a save that lost the race must not reach the deletes below.
      const claimed = await tx.baseConfig.updateMany({
        where: { id, updatedAt: config.updatedAt },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
          ...shapeColumnsOf(input, input.timerTemplate),
          ...(sections ? configTotalsOf(sections) : {}),
          updatedAt: new Date(),
        },
      });
      if (claimed.count !== 1) throw editedElsewhere(EDIT_SUBJECTS.BASE_CONFIG);

      // Its own write, after the claim: the stage's one default has to be given up before it is taken.
      if (input.isDefault !== undefined) {
        if (input.isDefault) await clearDefault(tx, config.examStageId, id);
        await tx.baseConfig.update({ where: { id }, data: { isDefault: input.isDefault } });
      }

      if (rewritten) {
        // Replaced wholesale: the editor holds the whole paper, and a section has no identity an edit could match on once its order or its subject changes.
        await tx.baseConfigSection.deleteMany({ where: { baseConfigId: id } });
        await tx.baseConfigModule.deleteMany({ where: { baseConfigId: id } });
        await writeChildren(tx, id, rewritten);
      }
    }, TX_LIMITS.SHORT);

    const updated = await this.requireDetail(id);
    this.auditContext.setChanged(fieldDiff(config, updated, AUDITED_CONFIG_FIELDS));
    // The catalog and the brief hold its duration, languages and navigation, which move on an offered test until its first sitting.
    if (config._count.tests > 0) {
      this.events.emit(DOMAIN_EVENTS.EXAM_STAGE_CHANGED, { examStageId: config.examStageId });
    }

    return toDetail(updated, await this.editingBy(id));
  }

  /** Clone-to-evolve: the copy carries the whole paper, points back at its origin, and starts unlocked and not the default. It is the only way a locked config changes. */
  async clone(
    id: string,
    input: CloneBaseConfigBody,
    createdById: string,
  ): Promise<BaseConfigDetail> {
    const source = await this.requireDetail(id);

    const cloneId = await this.prisma.$transaction(async (tx) => {
      const config = await tx.baseConfig.create({
        data: {
          examStageId: source.examStageId,
          name: input.name ?? `${source.name} v${source.version + 1}`,
          clonedFromId: source.id,
          version: source.version + 1,
          isDefault: false,
          createdById,
          totalQuestions: source.totalQuestions,
          totalMarks: source.totalMarks,
          durationSec: source.durationSec,
          timerTemplate: source.timerTemplate,
          navigation: source.navigation,
          optionalSectionCount: source.optionalSectionCount,
          defaultTestUi: source.defaultTestUi,
          examTemplate: source.examTemplate,
          languageMode: source.languageMode,
          languages: source.languages,
          shuffleQuestions: source.shuffleQuestions,
          shuffleOptions: source.shuffleOptions,
          calculatorEnabled: source.calculatorEnabled,
          scoringVersion: source.scoringVersion,
        },
      });

      const moduleIdByOrder = new Map<number, string>();
      for (const module of source.modules) {
        const copy = await tx.baseConfigModule.create({
          data: {
            baseConfigId: config.id,
            name: module.name,
            order: module.order,
            durationSec: module.durationSec,
          },
        });
        moduleIdByOrder.set(module.order, copy.id);
      }

      for (const section of source.sections) {
        const sourceModule = source.modules.find((module) => module.id === section.moduleId);
        await tx.baseConfigSection.create({
          data: {
            baseConfigId: config.id,
            // Matched by order, not by id: the copy's modules are new rows.
            moduleId:
              sourceModule === undefined ? null : (moduleIdByOrder.get(sourceModule.order) ?? null),
            name: section.name,
            order: section.order,
            subjectId: section.subjectId,
            questionCount: section.questionCount,
            marksPerQuestion: section.marksPerQuestion,
            negativeMarks: section.negativeMarks,
            durationSec: section.durationSec,
            perQuestionSec: section.perQuestionSec,
            mandatory: section.mandatory,
            meritOrQualifying: section.meritOrQualifying,
            qualifyingCutoff: section.qualifyingCutoff,
            patternNote: section.patternNote,
          },
        });
      }

      return config.id;
    }, TX_LIMITS.SHORT);

    return this.detail(cloneId);
  }

  /** Deleting is the one shape change nothing can undo, so it waits on whoever is mid-edit too. */
  async remove(id: string, editor: Editor = {}): Promise<void> {
    const config = await this.requireDetail(id);

    const blocker = configDeletionBlocker({
      locked: config.locked,
      testCount: config._count.tests,
      cloneCount: await this.prisma.baseConfig.count({ where: { clonedFromId: id } }),
    });
    if (blocker) throw new AppException(ErrorCodes.CONFLICT, blocker);

    await this.claimEdit(id, editor);
    await this.prisma.baseConfig.delete({ where: { id } });
  }

  /** A test's way in: a LOCKED config still takes tests — only a retired one refuses. */
  async assertUsable(id: string, fieldKey = 'baseConfigId'): Promise<BaseConfigDetail> {
    const config = await this.prisma.baseConfig.findUnique({
      where: { id },
      include: DETAIL_INCLUDE,
    });
    if (!config) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'No such config', {
        fieldErrors: { [fieldKey]: ['Pick a config'] },
      });
    }
    if (!config.isActive) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, INACTIVE_CONFIG_MESSAGE, {
        fieldErrors: { [fieldKey]: [INACTIVE_CONFIG_MESSAGE] },
      });
    }
    return toDetail(config, null);
  }

  private claimEdit(id: string, editor: Editor): Promise<void> {
    const key = redisKeys.baseConfigEditLock(id);
    return takeEditLock(this.redis, this.prisma, key, EDIT_SUBJECTS.BASE_CONFIG, editor);
  }

  private editingBy(id: string) {
    return editLockHeldBy(this.redis, this.prisma, redisKeys.baseConfigEditLock(id));
  }

  private assertRenderMode(examTemplate: ExamTemplate, defaultTestUi: TestUi): void {
    const issue = renderModeIssue(examTemplate, defaultTestUi);
    if (issue === null) return;

    throw new AppException(ErrorCodes.VALIDATION_ERROR, issue, {
      fieldErrors: { defaultTestUi: [issue] },
    });
  }

  private assertShape(
    timerTemplate: TimerTemplate,
    sections: readonly BaseConfigSectionDraft[],
    modules: readonly BaseConfigModuleDraft[],
    durationSec?: number,
  ): void {
    const issues = configShapeIssues(timerTemplate, sections, modules, durationSec);
    const [first] = issues;
    if (first === undefined) return;

    throw new AppException(ErrorCodes.VALIDATION_ERROR, first, {
      fieldErrors: { sections: issues },
    });
  }

  private async requireDetail(id: string): Promise<DetailRow> {
    const config = await this.prisma.baseConfig.findUnique({
      where: { id },
      include: DETAIL_INCLUDE,
    });
    if (!config) throw new AppException(ErrorCodes.NOT_FOUND, 'No such config');
    return config;
  }
}

/** A stage holds ONE default — a partial unique index says so — and the two writes have to share a transaction, or promoting a clone collides with the original it is replacing. */
async function clearDefault(
  tx: Prisma.TransactionClient,
  examStageId: string,
  exceptId: string | null,
): Promise<void> {
  await tx.baseConfig.updateMany({
    where: { examStageId, isDefault: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
    data: { isDefault: false },
  });
}

/** Only the shape fields a body actually carried — an omitted one keeps its column default. */
function shapeColumnsOf(
  input: Partial<CreateBaseConfigBody>,
  timerTemplate: TimerTemplate | undefined,
) {
  return {
    ...(input.durationSec === undefined ? {} : { durationSec: input.durationSec }),
    ...(timerTemplate === undefined ? {} : { timerTemplate }),
    ...(input.navigation === undefined ? {} : { navigation: input.navigation }),
    ...(input.optionalSectionCount === undefined
      ? {}
      : { optionalSectionCount: input.optionalSectionCount }),
    ...(input.defaultTestUi === undefined ? {} : { defaultTestUi: input.defaultTestUi }),
    ...(input.examTemplate === undefined ? {} : { examTemplate: input.examTemplate }),
    ...(input.languageMode === undefined ? {} : { languageMode: input.languageMode }),
    ...(input.languages === undefined ? {} : { languages: input.languages }),
    ...(input.shuffleQuestions === undefined ? {} : { shuffleQuestions: input.shuffleQuestions }),
    ...(input.shuffleOptions === undefined ? {} : { shuffleOptions: input.shuffleOptions }),
    ...(input.calculatorEnabled === undefined
      ? {}
      : { calculatorEnabled: input.calculatorEnabled }),
  };
}

/** Modules first: a section of a session paper has to name the module it sits in. */
async function writeChildren(
  tx: Prisma.TransactionClient,
  baseConfigId: string,
  paper: PaperRows,
): Promise<void> {
  const moduleIds: string[] = [];
  for (const module of paper.modules) {
    const created = await tx.baseConfigModule.create({ data: { baseConfigId, ...module } });
    moduleIds.push(created.id);
  }

  for (const { moduleRank, ...columns } of paper.sections) {
    await tx.baseConfigSection.create({
      data: {
        baseConfigId,
        moduleId: moduleRank === null ? null : (moduleIds[moduleRank] ?? null),
        ...columns,
      },
    });
  }
}

/** A form open since before somebody else's save would write its stale sections over theirs. */
function assertScreenIsCurrent(config: DetailRow, expected: string | undefined): void {
  if (expected === undefined || expected === config.updatedAt.toISOString()) return;
  throw editedElsewhere(EDIT_SUBJECTS.BASE_CONFIG);
}

/** A section's module by POSITION, since a save mints new module rows and there is no id a draft could carry. */
interface PaperRows {
  modules: { name: string; order: number; durationSec: number | null }[];
  sections: {
    moduleRank: number | null;
    name: string;
    order: number;
    subjectId: string | null;
    questionCount: number;
    marksPerQuestion: number;
    negativeMarks: number;
    durationSec: number | null;
    perQuestionSec: number | null;
    mandatory: boolean;
    meritOrQualifying: MeritType;
    qualifyingCutoff: number | null;
    patternNote: string | null;
  }[];
}

/** The ONE place a draft becomes a row. `writeChildren` writes these and `paperKeyOf` compares them, so a column cannot reach the database without also deciding whether the paper changed. */
function paperRowsOf(
  timerTemplate: TimerTemplate,
  sections: readonly BaseConfigSectionDraft[],
  modules: readonly BaseConfigModuleDraft[],
): PaperRows {
  const ordered = [...modules].sort((a, b) => a.order - b.order);
  const rankOf = new Map(ordered.map((module, rank) => [module.order, rank]));
  const sessionPaper = timerTemplate === TIMER_TEMPLATE.SESSION_MODULE_LOCKED;
  // Unnamed falls to the first module, which is what a one-module paper means without saying it.
  const firstRank = ordered.length > 0 ? 0 : null;
  // Only a session paper has modules, and a section names its own by order.
  const rankFor = (asked: number | null | undefined) =>
    sessionPaper ? (rankOf.get(asked ?? -1) ?? firstRank) : null;

  return {
    modules: ordered.map((module) => ({
      name: module.name,
      order: module.order,
      durationSec: module.durationSec ?? null,
    })),
    sections: sections.map((section) => ({
      moduleRank: rankFor(section.moduleOrder),
      name: section.name,
      order: section.order,
      subjectId: section.subjectId ?? null,
      questionCount: section.questionCount,
      marksPerQuestion: section.marksPerQuestion,
      negativeMarks: section.negativeMarks,
      durationSec: section.durationSec ?? null,
      perQuestionSec: section.perQuestionSec ?? null,
      mandatory: section.mandatory ?? true,
      meritOrQualifying: section.meritOrQualifying ?? MERIT_TYPE.MERIT,
      qualifyingCutoff: section.qualifyingCutoff ?? null,
      patternNote: section.patternNote ?? null,
    })),
  };
}

/** The stored paper back through the same mapper, so both sides of the comparison are built once. */
function storedPaperRows(config: DetailRow): PaperRows {
  const { modules, sections } = toDetail(config, null);
  const orderOfModule = new Map(modules.map((module) => [module.id, module.order]));
  const drafts: BaseConfigSectionDraft[] = sections.map((section) => ({
    ...section,
    moduleOrder: section.moduleId === null ? null : orderOfModule.get(section.moduleId),
  }));
  return paperRowsOf(config.timerTemplate as TimerTemplate, drafts, modules);
}

/** Every column of every row a save would write, so a new one cannot be invisible here. `order` alone is left out: the editor renumbers from zero whatever the stored numbers were, and position already carries the sequence. */
const paperKeyOf = (paper: PaperRows): string =>
  JSON.stringify([
    paper.modules.map(({ order: _order, ...columns }) => columns),
    [...paper.sections]
      .sort((a, b) => (a.moduleRank ?? -1) - (b.moduleRank ?? -1) || a.order - b.order)
      .map(({ order: _order, ...columns }) => columns),
  ]);

/** A stored section, in the form the shape rules read — they judge a draft, not a row. */
function toSectionDraft(section: DetailRow['sections'][number]): BaseConfigSectionDraft {
  return {
    name: section.name,
    order: section.order,
    questionCount: section.questionCount,
    marksPerQuestion: Number(section.marksPerQuestion),
    negativeMarks: Number(section.negativeMarks),
    durationSec: section.durationSec,
    patternNote: section.patternNote,
  };
}

function toConfig(row: ConfigRow): BaseConfig {
  return {
    id: row.id,
    examStageId: row.examStageId,
    examStage: row.examStage,
    name: row.name,
    isDefault: row.isDefault,
    clonedFromId: row.clonedFromId,
    version: row.version,
    isActive: row.isActive,
    locked: row.locked,
    totalQuestions: row.totalQuestions,
    totalMarks: Number(row.totalMarks),
    durationSec: row.durationSec,
    timerTemplate: row.timerTemplate,
    navigation: row.navigation,
    optionalSectionCount: row.optionalSectionCount,
    defaultTestUi: row.defaultTestUi,
    examTemplate: row.examTemplate,
    languageMode: row.languageMode,
    languages: row.languages,
    shuffleQuestions: row.shuffleQuestions,
    shuffleOptions: row.shuffleOptions,
    calculatorEnabled: row.calculatorEnabled,
    scoringVersion: row.scoringVersion,
    testCount: row._count.tests,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDetail(row: DetailRow, editingBy: EditLockHolder | null): BaseConfigDetail {
  return {
    ...toConfig(row),
    updatedAt: row.updatedAt.toISOString(),
    editingBy,
    modules: row.modules.map((module) => ({
      id: module.id,
      baseConfigId: module.baseConfigId,
      name: module.name,
      order: module.order,
      durationSec: module.durationSec,
    })),
    sections: row.sections.map((section) => ({
      id: section.id,
      baseConfigId: section.baseConfigId,
      moduleId: section.moduleId,
      name: section.name,
      order: section.order,
      subjectId: section.subjectId,
      questionCount: section.questionCount,
      marksPerQuestion: Number(section.marksPerQuestion),
      negativeMarks: Number(section.negativeMarks),
      durationSec: section.durationSec,
      perQuestionSec: section.perQuestionSec,
      mandatory: section.mandatory,
      meritOrQualifying: section.meritOrQualifying,
      qualifyingCutoff: section.qualifyingCutoff === null ? null : Number(section.qualifyingCutoff),
      patternNote: section.patternNote,
    })),
  };
}
