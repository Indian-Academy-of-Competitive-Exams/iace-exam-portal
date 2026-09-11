import { useQuery } from '@tanstack/react-query';
import {
  PAGE_SIZE_MAX,
  type TestScope,
  type TestSeriesKind,
  nameStem,
  seriesNameKind,
  suggestedSeriesName,
  suggestedTestName,
  testNameKind,
} from '@iace/contracts';
import { api } from './api';
import { QUERY_KEYS, QUERY_SCOPES } from './constants';

/** The names already on a stage, so a suggestion goes past the highest rather than repeating it. */

export interface TestNameSource {
  examCode?: string;
  stageName?: string;
  configName?: string;
  examStageId?: string;
  scope: TestScope;
  scopeName?: string | null;
}

export function useSuggestedTestName(source: TestNameSource): string | undefined {
  const ready = Boolean(source.examStageId && source.examCode && source.configName);
  const stem = nameStem(
    [source.examCode, source.stageName, source.configName],
    testNameKind(source),
  );

  const siblings = useQuery({
    queryKey: [...QUERY_KEYS.TESTS, QUERY_SCOPES.NAMED, source.examStageId, stem],
    queryFn: () =>
      api.admin.tests.list({
        page: 1,
        pageSize: PAGE_SIZE_MAX,
        examStageId: source.examStageId,
        q: stem,
      }),
    enabled: ready,
  });

  if (!ready) return undefined;
  const taken = (siblings.data?.items ?? []).map((test) => test.title ?? '');
  return suggestedTestName(stem, taken);
}

export interface SeriesNameSource {
  examCode?: string;
  stageName?: string;
  examStageId?: string;
  programCode?: string | null;
  kind?: TestSeriesKind;
}

export function useSuggestedSeriesName(source: SeriesNameSource): string | undefined {
  const ready = Boolean(source.examStageId && source.examCode);
  const stem = nameStem([source.examCode, source.stageName], seriesNameKind(source));

  const siblings = useQuery({
    queryKey: [...QUERY_KEYS.TEST_SERIES, QUERY_SCOPES.NAMED, source.examStageId, stem],
    queryFn: () =>
      api.admin.testSeries.list({
        page: 1,
        pageSize: PAGE_SIZE_MAX,
        examStageId: source.examStageId,
        q: stem,
      }),
    enabled: ready,
  });

  if (!ready) return undefined;
  const taken = (siblings.data?.items ?? []).map((series) => series.name);
  return suggestedSeriesName(stem, taken);
}
