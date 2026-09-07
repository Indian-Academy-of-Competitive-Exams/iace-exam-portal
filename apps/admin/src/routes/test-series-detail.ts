import { type UseFormReturn } from 'react-hook-form';
import {
  type CreateTestSeriesBody,
  EVALUATION_MODE,
  EVALUATION_MODES,
  EVALUATION_MODE_LABELS,
  type EvaluationMode,
  TEST_SERIES_KIND,
  TEST_SERIES_KINDS,
  type TestSeriesKind,
  type TestSeriesSummary,
} from '@iace/contracts';
import {
  EVALUATION_MODE_HINTS,
  QUERY_KEYS,
  TEST_SERIES_KIND_HINTS,
  TEST_SERIES_KIND_LABELS,
} from '../lib/constants';

/** One series read four ways. What more than one of its tabs needs lives here, and only that. */

/** The three views of the one record. A tab that saves itself is standalone; the form is the other. */
export const SERIES_TAB = {
  DETAILS: 'details',
  TESTS: 'tests',
  BRANCHES: 'branches',
} as const;
export type SeriesTab = (typeof SERIES_TAB)[keyof typeof SERIES_TAB];

export interface SeriesFormValues {
  name: string;
  description: string;
  examStageId: string;
  programCode: string;
  eventId: string;
  sequentialTests: boolean;
  progressive: boolean;
  kind: TestSeriesKind;
  evaluationMode: EvaluationMode;
}

export const seriesKey = (id: string) => [...QUERY_KEYS.TEST_SERIES, id] as const;
export const branchesKey = (id: string) => [...QUERY_KEYS.TEST_SERIES, id, 'branches'] as const;
export const testsKey = (id: string) => [...QUERY_KEYS.TEST_SERIES, id, 'tests'] as const;

/** Every path the server can name that this form registers, so a failure lands on its own input. */
export const SERVER_FIELDS = [
  'name',
  'description',
  'examStageId',
  'programCode',
  'eventId',
  'kind',
  'evaluationMode',
] as const;

export const KIND_ITEMS = TEST_SERIES_KINDS.map((value) => ({
  value,
  label: TEST_SERIES_KIND_LABELS[value],
  hint: TEST_SERIES_KIND_HINTS[value],
}));

export const EVALUATION_ITEMS = EVALUATION_MODES.map((value) => ({
  value,
  label: EVALUATION_MODE_LABELS[value],
  hint: EVALUATION_MODE_HINTS[value],
}));

/** A program and an event each belong to one kind, so both leave with the kind that carried them. */
export function chooseKind(form: UseFormReturn<SeriesFormValues>, next: TestSeriesKind): void {
  form.setValue('kind', next, { shouldDirty: true });
  if (next !== TEST_SERIES_KIND.PROGRAM) form.setValue('programCode', '', { shouldDirty: true });
  if (next !== TEST_SERIES_KIND.EVENT) form.setValue('eventId', '', { shouldDirty: true });
}

export function valuesOf(detail: TestSeriesSummary | null): SeriesFormValues {
  return {
    name: detail?.name ?? '',
    description: detail?.description ?? '',
    examStageId: detail?.examStageId ?? '',
    programCode: detail?.programCode ?? '',
    eventId: detail?.eventId ?? '',
    sequentialTests: detail?.sequentialTests ?? false,
    progressive: detail?.progressive ?? false,
    kind: detail?.kind ?? TEST_SERIES_KIND.STANDARD,
    evaluationMode: detail?.evaluationMode ?? EVALUATION_MODE.RANKED,
  };
}

/** An empty picker means "no choice", which the API expresses as null. */
export function bodyOf(values: SeriesFormValues): CreateTestSeriesBody {
  return {
    name: values.name,
    description: values.description.trim(),
    examStageId: values.examStageId || null,
    // Each target belongs to one kind, so the field it came from cannot outlive that kind.
    programCode: values.kind === TEST_SERIES_KIND.PROGRAM ? values.programCode || null : null,
    eventId: values.kind === TEST_SERIES_KIND.EVENT ? values.eventId || null : null,
    sequentialTests: values.sequentialTests,
    progressive: values.progressive,
    kind: values.kind,
    evaluationMode: values.evaluationMode,
  };
}
