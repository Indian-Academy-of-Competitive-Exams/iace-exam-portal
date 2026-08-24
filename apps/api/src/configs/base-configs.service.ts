import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  FORM_LEVEL_FIELD,
  TIMER_TEMPLATE,
  configTotalsOf,
  fieldDiff,
  type BaseConfig,
  type BaseConfigDetail,
  type BaseConfigListQuery,
  type BaseConfigModuleDraft,
  type BaseConfigSectionDraft,
  type CloneBaseConfigBody,
  type CreateBaseConfigBody,
  type Paginated,
  type TimerTemplate,
  type UpdateBaseConfigBody,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditContext } from '../audit';
import { ExamStagesService } from './exam-stages.service';
import {
  configDeletionBlocker,
  configShapeIssues,
  INACTIVE_CONFIG_MESSAGE,
  locksOutEdit,
  LOCKED_CONFIG_MESSAGE,
} from './base-config-rules';

const CONFIG_INCLUDE = {
  examStage: {
    select: {
      id: true,
      stageKey: true,
      name: true,
      exam: { select: { id: true, code: true, name: true, family: true } },
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

/**
 * Owns `BaseConfig`, `BaseConfigModule` and `BaseConfigSection` — a stage's blueprint. A test
 * inherits its shape rather than restating it, so the config freezes when the first paper does.
 */
@Injectable()
export class BaseConfigsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stages: ExamStagesService,
    private readonly auditContext: AuditContext,
  ) {}

  async list(query: BaseConfigListQuery): Promise<Paginated<BaseConfig>> {
    const where: Prisma.BaseConfigWhereInput = {
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
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
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.baseConfig.count({ where }),
    ]);

    return { items: rows.map(toConfig), page: query.page, pageSize: query.pageSize, total };
  }

  async detail(id: string): Promise<BaseConfigDetail> {
    return toDetail(await this.requireDetail(id));
  }

  async create(input: CreateBaseConfigBody, createdById: string): Promise<BaseConfigDetail> {
    await this.stages.assertUsable(input.examStageId);

    const timerTemplate = input.timerTemplate ?? TIMER_TEMPLATE.COMPOSITE_FREE;
    const modules = input.modules ?? [];
    this.assertShape(timerTemplate, input.sections, modules, input.durationSec);

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

      await writeChildren(tx, config.id, timerTemplate, input.sections, modules);
      return config.id;
    });

    return this.detail(id);
  }

  /**
   * A locked config refuses every shape change here rather than at the database's trigger, so the
   * admin reads a sentence instead of a Postgres exception. Name, default and active still move —
   * that is what lets a clone be promoted over the locked original it replaces.
   */
  async update(id: string, input: UpdateBaseConfigBody): Promise<BaseConfigDetail> {
    const config = await this.requireDetail(id);

    if (config.locked && locksOutEdit(input)) {
      throw new AppException(ErrorCodes.CONFLICT, LOCKED_CONFIG_MESSAGE, {
        fieldErrors: { [FORM_LEVEL_FIELD]: [LOCKED_CONFIG_MESSAGE] },
      });
    }

    const timerTemplate = input.timerTemplate ?? (config.timerTemplate as TimerTemplate);
    const sections = input.sections;
    const modules = input.modules ?? (input.sections ? [] : undefined);
    // Judged against what the config WILL hold: switching the timer alone can leave the sections
    // in a shape the new template forbids, and the database would refuse that with a raw error.
    this.assertShape(
      timerTemplate,
      sections ?? config.sections.map(toSectionDraft),
      modules ?? config.modules,
      input.durationSec ?? config.durationSec,
    );

    await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) await clearDefault(tx, config.examStageId, id);

      await tx.baseConfig.update({
        where: { id },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
          ...shapeColumnsOf(input, input.timerTemplate),
          ...(sections ? configTotalsOf(sections) : {}),
        },
      });

      if (sections) {
        // Replaced wholesale: the editor holds the whole paper, and a section has no identity
        // an edit could match on once its order or its subject changes.
        await tx.baseConfigSection.deleteMany({ where: { baseConfigId: id } });
        await tx.baseConfigModule.deleteMany({ where: { baseConfigId: id } });
        await writeChildren(tx, id, timerTemplate, sections, modules ?? []);
      }
    });

    const updated = await this.requireDetail(id);
    this.auditContext.setChanged(fieldDiff(config, updated, AUDITED_CONFIG_FIELDS));

    return toDetail(updated);
  }

  /**
   * Clone-to-evolve: the copy carries the whole paper, points back at its origin, and starts
   * unlocked and not the default. It is the only way a locked config changes.
   */
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
          },
        });
      }

      return config.id;
    });

    return this.detail(cloneId);
  }

  async remove(id: string): Promise<void> {
    const config = await this.requireDetail(id);

    const blocker = configDeletionBlocker({
      locked: config.locked,
      testCount: config._count.tests,
    });
    if (blocker) throw new AppException(ErrorCodes.CONFLICT, blocker);

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
    return toDetail(config);
  }

  private assertShape(
    timerTemplate: TimerTemplate,
    sections: readonly BaseConfigSectionDraft[],
    modules: readonly BaseConfigModuleDraft[],
    durationSec?: number,
  ): void {
    const issues = configShapeIssues(timerTemplate, sections, modules, durationSec);
    if (issues.length === 0) return;

    throw new AppException(ErrorCodes.VALIDATION_ERROR, issues[0]!, {
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

/**
 * A stage holds ONE default — a partial unique index says so — and the two writes have to share a
 * transaction, or promoting a clone collides with the original it is replacing.
 */
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
  timerTemplate: TimerTemplate,
  sections: readonly BaseConfigSectionDraft[],
  modules: readonly BaseConfigModuleDraft[],
): Promise<void> {
  const moduleIdByOrder = new Map<number, string>();
  for (const module of modules) {
    const created = await tx.baseConfigModule.create({
      data: {
        baseConfigId,
        name: module.name,
        order: module.order,
        durationSec: module.durationSec ?? null,
      },
    });
    moduleIdByOrder.set(module.order, created.id);
  }

  const sessionPaper = timerTemplate === TIMER_TEMPLATE.SESSION_MODULE_LOCKED;

  for (const section of sections) {
    await tx.baseConfigSection.create({
      data: {
        baseConfigId,
        // Only a session paper has modules, and a section names its own by order. Unnamed falls
        // to the first, which is what a one-module paper means without saying it.
        moduleId: sessionPaper
          ? (moduleIdByOrder.get(section.moduleOrder ?? -1) ?? firstOf(moduleIdByOrder))
          : null,
        name: section.name,
        order: section.order,
        subjectId: section.subjectId ?? null,
        questionCount: section.questionCount,
        marksPerQuestion: section.marksPerQuestion,
        negativeMarks: section.negativeMarks,
        durationSec: section.durationSec ?? null,
        perQuestionSec: section.perQuestionSec ?? null,
        ...(section.mandatory === undefined ? {} : { mandatory: section.mandatory }),
        ...(section.meritOrQualifying === undefined
          ? {}
          : { meritOrQualifying: section.meritOrQualifying }),
        qualifyingCutoff: section.qualifyingCutoff ?? null,
      },
    });
  }
}

/** A stored section, in the form the shape rules read — they judge a draft, not a row. */
function toSectionDraft(section: DetailRow['sections'][number]): BaseConfigSectionDraft {
  return {
    name: section.name,
    order: section.order,
    questionCount: section.questionCount,
    marksPerQuestion: Number(section.marksPerQuestion),
    negativeMarks: Number(section.negativeMarks),
    durationSec: section.durationSec,
  };
}

function firstOf(byOrder: Map<number, string>): string | null {
  return [...byOrder.values()][0] ?? null;
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

function toDetail(row: DetailRow): BaseConfigDetail {
  return {
    ...toConfig(row),
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
    })),
  };
}
