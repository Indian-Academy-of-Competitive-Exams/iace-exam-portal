import {
  REPORT_PARAMS,
  REPORT_TOP_DEFAULT,
  type ReportFact,
  type ReportParam,
  type ReportSpec,
} from '@iace/contracts';
import { type ListFilter, type ListFilterControl } from '@iace/ui';
import { TestPicker } from '../../components/test-picker';
import { REPORT_PARAM_LABELS } from '../../lib/constants';

const TOP_CHOICES = [25, 50, 100] as const;

interface FilterContext {
  /** A needed param has no "none": its picker is not clearable. */
  needed: boolean;
  /** What the loaded report says it covers, which names a choice the picker has not paged to. */
  about: readonly ReportFact[];
}

const namedIn = (about: readonly ReportFact[], label: string): string | undefined => {
  const value = about.find((fact) => fact.label === label)?.value;
  return typeof value === 'string' ? value : undefined;
};

/** One entry per param a catalogue row can name; a row asking for one not here draws no control. */
const PARAM_FILTERS: Partial<Record<ReportParam, (context: FilterContext) => ListFilter>> = {
  [REPORT_PARAMS.TEST]: ({ needed, about }) => ({
    key: 'testId',
    kind: 'custom',
    label: REPORT_PARAM_LABELS[REPORT_PARAMS.TEST],
    primary: true,
    width: 'w-80',
    render: (control: ListFilterControl) => (
      <TestPicker {...control} clearable={!needed} selectedLabel={namedIn(about, 'Test')} />
    ),
  }),
  [REPORT_PARAMS.TOP]: () => ({
    key: 'top',
    kind: 'choice',
    label: REPORT_PARAM_LABELS[REPORT_PARAMS.TOP],
    primary: true,
    items: [
      { value: '', label: `Top ${REPORT_TOP_DEFAULT}` },
      ...TOP_CHOICES.map((top) => ({ value: String(top), label: `Top ${top}` })),
    ],
  }),
};

/** The bar a report is asked through, read off its catalogue row: what it needs, then what narrows it. */
export function reportFilters(spec: ReportSpec, about: readonly ReportFact[]): ListFilter[] {
  const drawn = (params: readonly ReportParam[], needed: boolean) =>
    params.flatMap((param) => {
      const filter = PARAM_FILTERS[param];
      return filter ? [filter({ needed, about })] : [];
    });
  return [...drawn(spec.needs, true), ...drawn(spec.takes ?? [], false)];
}
