import { type UseFormReturn } from 'react-hook-form';
import {
  AppException,
  DEFAULT_PAPER_VARIANTS,
  type DrawSpec,
  DRAW_STRATEGY,
  EVALUATION_MODE,
  PAPER_BINDING,
  TEST_SCOPE,
  type DrawStrategy,
  type EvaluationMode,
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
  title: string;
  scope: TestScope;
  moduleId: string;
  sectionId: string;
  topicIds: string[];
  evaluationMode: EvaluationMode;
  paperBinding: PaperBinding;
  maxRetakes: string;
  variantCount: string;
  drawSpec: DrawSpec;
  drawStrategy: DrawStrategy;
}

export type TestForm = UseFormReturn<TestFormValues>;

export function valuesOf(detail: TestDetail | null): TestFormValues {
  const scopeRef = detail?.scopeRef ?? null;
  return {
    examId: detail?.examStage.exam.id ?? '',
    examStageId: detail?.examStageId ?? '',
    baseConfigId: detail?.baseConfigId ?? '',
    title: detail?.title ?? '',
    scope: detail?.scope ?? TEST_SCOPE.FULL,
    moduleId: scopeRef?.moduleId ?? '',
    sectionId: scopeRef?.sectionId ?? '',
    topicIds: scopeRef?.topicIds ?? [],
    evaluationMode: detail?.evaluationMode ?? EVALUATION_MODE.RANKED,
    paperBinding: detail?.paperBinding ?? PAPER_BINDING.FIXED,
    maxRetakes: detail?.maxRetakes === null || detail === null ? '' : String(detail.maxRetakes),
    variantCount: String(detail?.variantCount ?? DEFAULT_PAPER_VARIANTS),
    drawSpec: detail?.questionPoolFilter ?? { sections: {} },
    drawStrategy: detail?.drawStrategy ?? DRAW_STRATEGY.RANDOM,
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
  if (values.scope === TEST_SCOPE.TOPIC) {
    return values.topicIds.length > 0 ? { topicIds: values.topicIds } : null;
  }
  return null;
}

export const RETAKES_NOT_A_NUMBER =
  'Give a whole number of retakes, or leave it blank for unlimited';

/** The keys the server answers with. `scopeRef` has no control of its own — see `SCOPE_FIELDS`. */
export const SERVER_FIELDS = [
  'baseConfigId',
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
  [TEST_SCOPE.TOPIC]: 'topicIds',
};

export function applyServerErrors(error: unknown, form: TestForm, scope: TestScope): void {
  applyFieldErrors(error, form.setError, [
    'baseConfigId',
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
