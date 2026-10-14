import { type Path, type UseFormReturn } from 'react-hook-form';
import {
  AppException,
  EXAM_TEMPLATE,
  LANGUAGE_CODE,
  LANGUAGE_MODE,
  MERIT_TYPE,
  NAVIGATION_POLICY,
  TEST_UI,
  TIMER_TEMPLATE,
  type BaseConfigDetail,
  type BaseConfigSection,
  type BaseConfigSectionDraft,
  type ExamTemplate,
  type LanguageCode,
  type LanguageMode,
  type MeritType,
  type NavigationPolicy,
  type TestUi,
  type TimerTemplate,
  typingPresetKeySchema,
} from '@iace/contracts';
import { applyFieldErrors, isNumberOrBlank, numberOr, optionalNumber } from '@iace/app-kit';
import { minutesFieldOf, secondsFromMinutes } from '../../lib/duration';

interface SectionValues {
  name: string;
  subjectId: string;
  /** The index of the module this sits in — a session paper's only. */
  moduleOrder: string;
  questionCount: string;
  marksPerQuestion: string;
  negativeMarks: string;
  durationMin: string;
  perQuestionSec: string;
  mandatory: boolean;
  meritOrQualifying: MeritType;
  qualifyingCutoff: string;
  patternNote: string;
  /** A typing standard's key, or empty for an ordinary section. */
  typingPreset: string;
  /** Written answers: essays, letters, précis. */
  descriptive: boolean;
  /** One language of the paper's that the section is sat in alone, or empty for all of them. */
  language: string;
}

interface ModuleValues {
  name: string;
  durationMin: string;
}

export interface ConfigFormValues {
  examStageId: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  durationMin: string;
  timerTemplate: TimerTemplate;
  navigation: NavigationPolicy;
  optionalSectionCount: string;
  defaultTestUi: TestUi;
  examTemplate: ExamTemplate;
  languageMode: LanguageMode;
  languages: LanguageCode[];
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  calculatorEnabled: boolean;
  modules: ModuleValues[];
  sections: SectionValues[];
}

export function emptySection(): SectionValues {
  return {
    name: '',
    subjectId: '',
    moduleOrder: '',
    questionCount: '',
    marksPerQuestion: '1',
    patternNote: '',
    negativeMarks: '0',
    durationMin: '',
    perQuestionSec: '',
    mandatory: true,
    meritOrQualifying: MERIT_TYPE.MERIT,
    qualifyingCutoff: '',
    typingPreset: '',
    descriptive: false,
    language: '',
  };
}

function emptyValues(): ConfigFormValues {
  return {
    examStageId: '',
    name: '',
    isDefault: false,
    isActive: true,
    durationMin: '',
    timerTemplate: TIMER_TEMPLATE.COMPOSITE_FREE,
    navigation: NAVIGATION_POLICY.FREE,
    optionalSectionCount: '',
    defaultTestUi: TEST_UI.CBT,
    examTemplate: EXAM_TEMPLATE.DEFAULT,
    languageMode: LANGUAGE_MODE.SINGLE,
    languages: [LANGUAGE_CODE.EN],
    shuffleQuestions: false,
    shuffleOptions: false,
    calculatorEnabled: false,
    modules: [],
    sections: [emptySection()],
  };
}

/** A section names its module by order, and the modules are new rows on every save. */
function moduleFieldOf(detail: BaseConfigDetail, section: BaseConfigSection): string {
  const index = detail.modules.findIndex((module) => module.id === section.moduleId);
  return index < 0 ? '' : String(index);
}

export function valuesOf(detail: BaseConfigDetail | null): ConfigFormValues {
  if (detail === null) return emptyValues();

  return {
    examStageId: detail.examStageId,
    name: detail.name,
    isDefault: detail.isDefault,
    isActive: detail.isActive,
    durationMin: minutesFieldOf(detail.durationSec),
    timerTemplate: detail.timerTemplate,
    navigation: detail.navigation,
    optionalSectionCount:
      detail.optionalSectionCount === null ? '' : String(detail.optionalSectionCount),
    defaultTestUi: detail.defaultTestUi,
    examTemplate: detail.examTemplate,
    languageMode: detail.languageMode,
    languages: [...detail.languages],
    shuffleQuestions: detail.shuffleQuestions,
    shuffleOptions: detail.shuffleOptions,
    calculatorEnabled: detail.calculatorEnabled,
    modules: detail.modules.map((module) => ({
      name: module.name,
      durationMin: minutesFieldOf(module.durationSec),
    })),
    sections: detail.sections.map((section) => ({
      name: section.name,
      subjectId: section.subjectId ?? '',
      moduleOrder: moduleFieldOf(detail, section),
      questionCount: String(section.questionCount),
      marksPerQuestion: String(section.marksPerQuestion),
      negativeMarks: String(section.negativeMarks),
      patternNote: section.patternNote ?? '',
      durationMin: minutesFieldOf(section.durationSec),
      perQuestionSec: section.perQuestionSec === null ? '' : String(section.perQuestionSec),
      mandatory: section.mandatory,
      meritOrQualifying: section.meritOrQualifying,
      qualifyingCutoff: section.qualifyingCutoff === null ? '' : String(section.qualifyingCutoff),
      typingPreset: section.typingPreset ?? '',
      descriptive: section.descriptive,
      language: section.languages[0] ?? '',
    })),
  };
}

export function toSectionDraft(section: SectionValues, index: number): BaseConfigSectionDraft {
  return {
    name: section.name,
    // The list order IS the paper's order: nothing types a position two sections could share.
    order: index,
    moduleOrder: optionalNumber(section.moduleOrder),
    subjectId: section.subjectId || null,
    questionCount: numberOr(section.questionCount, 0),
    marksPerQuestion: numberOr(section.marksPerQuestion, 0),
    negativeMarks: numberOr(section.negativeMarks, 0),
    patternNote: section.patternNote.trim() || null,
    durationSec: secondsFromMinutes(section.durationMin),
    perQuestionSec: optionalNumber(section.perQuestionSec),
    mandatory: section.mandatory,
    meritOrQualifying: section.meritOrQualifying,
    qualifyingCutoff:
      section.meritOrQualifying === MERIT_TYPE.QUALIFYING
        ? optionalNumber(section.qualifyingCutoff)
        : null,
    typingPreset: typingPresetKeySchema.safeParse(section.typingPreset).data ?? null,
    descriptive: section.descriptive,
    languages: section.language ? [section.language as LanguageCode] : [],
  };
}

export function shapeOf(values: ConfigFormValues) {
  const sessionPaper = values.timerTemplate === TIMER_TEMPLATE.SESSION_MODULE_LOCKED;

  return {
    durationSec: secondsFromMinutes(values.durationMin) ?? 0,
    timerTemplate: values.timerTemplate,
    navigation: values.navigation,
    optionalSectionCount: optionalNumber(values.optionalSectionCount),
    defaultTestUi: values.defaultTestUi,
    examTemplate: values.examTemplate,
    languageMode: values.languageMode,
    languages: values.languages,
    shuffleQuestions: values.shuffleQuestions,
    shuffleOptions: values.shuffleOptions,
    calculatorEnabled: values.calculatorEnabled,
    sections: values.sections.map((section, index) => toSectionDraft(section, index)),
    // Only a session paper has modules; the server refuses a paper that carries them otherwise.
    modules: sessionPaper
      ? values.modules.map((module, index) => ({
          name: module.name,
          order: index,
          durationSec: secondsFromMinutes(module.durationMin),
        }))
      : [],
  };
}

/** Refused before the save: read as blank, text in a number field would be stored as "not set" or zero. */
export const NUMBER_FIELD = {
  validate: (raw: string) => isNumberOrBlank(raw) || 'Enter a number',
} as const;

const CONFIG_SERVER_FIELDS = ['examStageId', 'name', 'optionalSectionCount', 'languages'] as const;
const SECTION_SERVER_FIELDS = [
  'name',
  'questionCount',
  'marksPerQuestion',
  'negativeMarks',
  'perQuestionSec',
  'qualifyingCutoff',
  'patternNote',
] as const;
const SESSION_SERVER_FIELDS = ['name'] as const;

function rowFields(rows: 'sections' | 'modules', count: number, fields: readonly string[]) {
  return Array.from({ length: count }, (_, index) =>
    fields.map((field) => `${rows}.${index}.${field}` as Path<ConfigFormValues>),
  ).flat();
}

/** Every path the server can name that this form registers, so a failure lands on its own input. */
export function serverFields(sectionCount: number, sessionCount: number): Path<ConfigFormValues>[] {
  return [
    ...CONFIG_SERVER_FIELDS,
    ...rowFields('sections', sectionCount, SECTION_SERVER_FIELDS),
    ...rowFields('modules', sessionCount, SESSION_SERVER_FIELDS),
  ];
}

/** The whole-paper rules. They name no single input, so they are listed above the sections. */
export function sectionIssuesOf(error: unknown): string[] {
  return AppException.is(error) ? (error.fieldErrors?.sections ?? []) : [];
}

/** The API names its clocks in seconds and the form asks for minutes — the same input either way. */
function minutesFieldFor(key: string): Path<ConfigFormValues> | null {
  if (key === 'durationSec') return 'durationMin';
  const row = /^(sections|modules)\.(\d+)\.durationSec$/.exec(key);
  return row ? (`${row[1]}.${row[2]}.durationMin` as Path<ConfigFormValues>) : null;
}

export function applyServerErrors(error: unknown, form: UseFormReturn<ConfigFormValues>): void {
  const { sections, modules } = form.getValues();
  applyFieldErrors(error, form.setError, serverFields(sections.length, modules.length));
  if (!AppException.is(error) || !error.fieldErrors) return;

  for (const [key, messages] of Object.entries(error.fieldErrors)) {
    const field = minutesFieldFor(key);
    if (field && messages[0]) form.setError(field, { type: 'server', message: messages[0] });
  }
}

/** What the banner would repeat: `sections` has its own list, and each clock its own Minutes input. */
export function shownElsewhere(error: unknown): string[] {
  const keys = AppException.is(error) ? Object.keys(error.fieldErrors ?? {}) : [];
  return ['sections', ...keys.filter((key) => minutesFieldFor(key) !== null)];
}
