import { type UseFormReturn } from 'react-hook-form';
import {
  AppException,
  DEFAULT_PAPER_VARIANTS,
  PAPER_BINDING,
  TEST_SCOPE,
  type EvaluationMode,
  type ExamTemplate,
  type PaperBinding,
  type TestDetail,
  type TestScope,
  type TestScopeRef,
} from '@iace/contracts';
import { applyFieldErrors } from '@iace/app-kit';

/** What the two field steps hold between them, and how a save answers back onto them. */

export interface TestFormValues {
  examId: string;
  examStageId: string;
  baseConfigId: string;
  testSeriesId: string;
  /** Held beside the id so the screen can name the series without asking the server for it again. */
  testSeriesName: string;
  title: string;
  scope: TestScope;
  moduleId: string;
  sectionId: string;
  /** Read off the chosen series and never sent: the server derives it from that series too. */
  evaluationMode: EvaluationMode | '';
  paperBinding: PaperBinding;
  /** Null until the admin picks one — the config's default stands in until they do. */
  examTemplate: ExamTemplate | null;
  maxRetakes: string;
  variantCount: string;
}

export type TestForm = UseFormReturn<TestFormValues>;

export function valuesOf(detail: TestDetail | null): TestFormValues {
  const scopeRef = detail?.scopeRef ?? null;
  return {
    examId: detail?.examStage.exam.id ?? '',
    examStageId: detail?.examStageId ?? '',
    baseConfigId: detail?.baseConfigId ?? '',
    testSeriesId: detail?.testSeriesId ?? '',
    testSeriesName: detail?.testSeriesName ?? '',
    title: detail?.title ?? '',
    scope: detail?.scope ?? TEST_SCOPE.FULL,
    moduleId: scopeRef?.moduleId ?? '',
    sectionId: scopeRef?.sectionId ?? '',
    evaluationMode: detail?.evaluationMode ?? '',
    paperBinding: detail?.paperBinding ?? PAPER_BINDING.FIXED,
    examTemplate: detail?.examTemplate ?? null,
    maxRetakes: detail?.maxRetakes === null || detail === null ? '' : String(detail.maxRetakes),
    variantCount: String(detail?.variantCount ?? DEFAULT_PAPER_VARIANTS),
  };
}

/** An empty reference is sent as none, so the server answers with the prompt naming what is missing. */
export function scopeRefOf(values: TestFormValues): TestScopeRef | null {
  if (values.scope === TEST_SCOPE.MODULE) {
    return values.moduleId ? { moduleId: values.moduleId } : null;
  }
  if (values.scope === TEST_SCOPE.SECTIONAL) {
    return values.sectionId ? { sectionId: values.sectionId } : null;
  }
  return null;
}

export const RETAKES_NOT_A_NUMBER =
  'Give a whole number of retakes, or leave it blank for unlimited';

/** The keys the server answers with. `scopeRef` has no control of its own — see `SCOPE_FIELDS`. */
export const SERVER_FIELDS = [
  'baseConfigId',
  'testSeriesId',
  'title',
  'paperBinding',
  'maxRetakes',
  'variantCount',
  'scopeRef',
] as const;

/** Which control a `scopeRef` error belongs on, since the reference is a different one per scope. */
const SCOPE_FIELDS: Readonly<Record<TestScope, keyof TestFormValues | null>> = {
  [TEST_SCOPE.FULL]: null,
  [TEST_SCOPE.MODULE]: 'moduleId',
  [TEST_SCOPE.SECTIONAL]: 'sectionId',
};

export function applyServerErrors(error: unknown, form: TestForm, scope: TestScope): void {
  applyFieldErrors(error, form.setError, [
    'baseConfigId',
    'testSeriesId',
    'title',
    'paperBinding',
    'maxRetakes',
    'variantCount',
  ]);
  const field = SCOPE_FIELDS[scope];
  if (!field || !AppException.is(error)) return;
  const message = error.fieldErrors?.scopeRef?.[0];
  if (message) form.setError(field, { type: 'server', message });
}
