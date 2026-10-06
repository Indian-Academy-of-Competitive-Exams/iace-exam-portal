import {
  REPORT_PARAMS,
  REPORT_PERIODS,
  REPORT_TOP_DEFAULT,
  reportPeriodOf,
  type ReportFact,
  type ReportParam,
  type ReportPeriod,
  type ReportPeriodRange,
  type ReportSpec,
} from '@iace/contracts';
import { Combobox, type ListFilter, type ListFilterControl } from '@iace/ui';
import { TestSeriesPicker } from '../../components/access-picker';
import { TestPicker } from '../../components/test-picker';
import { REPORT_PARAM_LABELS, REPORT_PERIOD_LABELS } from '../../lib/constants';

const TOP_CHOICES = [25, 50, 100] as const;
const PERIODS: readonly ReportPeriod[] = Object.values(REPORT_PERIODS);

interface FilterContext {
  /** A needed param has no "none": its picker is not clearable. */
  needed: boolean;
  /** What the loaded report says it covers, which names a choice the picker has not paged to. */
  about: readonly ReportFact[];
  /** The dates the report is being read for, whether chosen or the row's own default. */
  period: Partial<ReportPeriodRange>;
  setPeriod: (period: ReportPeriodRange) => void;
}

const namedIn = (about: readonly ReportFact[], label: string): string | undefined => {
  const value = about.find((fact) => fact.label === label)?.value;
  return typeof value === 'string' ? value : undefined;
};

/** The named period the two dates amount to, or none when they were picked by hand. */
function periodNamed({ from, to }: Partial<ReportPeriodRange>): ReportPeriod | '' {
  const named = PERIODS.find((period) => {
    const range = reportPeriodOf(period);
    return range.from === from && range.to === to;
  });
  return named ?? '';
}

/** One entry per param a catalogue row can name; a row asking for one not here draws no control. */
const PARAM_FILTERS: Partial<Record<ReportParam, (context: FilterContext) => ListFilter[]>> = {
  [REPORT_PARAMS.TEST]: ({ needed, about }) => [
    {
      key: 'testId',
      kind: 'custom',
      label: REPORT_PARAM_LABELS[REPORT_PARAMS.TEST],
      primary: true,
      width: 'w-80',
      render: (control: ListFilterControl) => (
        <TestPicker {...control} clearable={!needed} selectedLabel={namedIn(about, 'Test')} />
      ),
    },
  ],
  [REPORT_PARAMS.SERIES]: ({ needed, about }) => [
    {
      key: 'seriesId',
      kind: 'custom',
      label: REPORT_PARAM_LABELS[REPORT_PARAMS.SERIES],
      primary: true,
      width: 'w-80',
      render: ({ onChange, ...control }: ListFilterControl) => (
        <TestSeriesPicker
          {...control}
          clearable={!needed}
          placeholder="Choose a series"
          selectedLabel={namedIn(about, 'Series')}
          onChange={(chosen) => onChange(chosen.id)}
        />
      ),
    },
  ],
  // One control that sets two dates, beside the two dates themselves for a period no name fits.
  [REPORT_PARAMS.PERIOD]: ({ period, setPeriod }) => [
    {
      key: 'period',
      kind: 'custom',
      label: REPORT_PARAM_LABELS[REPORT_PARAMS.PERIOD],
      primary: true,
      width: 'w-44',
      render: (control: ListFilterControl) => (
        <Combobox
          {...control}
          value={periodNamed(period)}
          onChange={(named) => setPeriod(reportPeriodOf(named as ReportPeriod))}
          clearable={false}
          placeholder="Custom period"
          items={PERIODS.map((value) => ({ value, label: REPORT_PERIOD_LABELS[value] }))}
        />
      ),
    },
    { key: 'from', kind: 'date', label: 'From', primary: true, max: period.to },
    { key: 'to', kind: 'date', label: 'To', primary: true, min: period.from },
  ],
  [REPORT_PARAMS.TOP]: () => [
    {
      key: 'top',
      kind: 'choice',
      label: REPORT_PARAM_LABELS[REPORT_PARAMS.TOP],
      primary: true,
      items: [
        { value: '', label: `Top ${REPORT_TOP_DEFAULT}` },
        ...TOP_CHOICES.map((top) => ({ value: String(top), label: `Top ${top}` })),
      ],
    },
  ],
};

/** The bar a report is asked through, read off its catalogue row: what it needs, then what narrows it. */
export function reportFilters(
  spec: ReportSpec,
  context: Omit<FilterContext, 'needed'>,
): ListFilter[] {
  const drawn = (params: readonly ReportParam[], needed: boolean) =>
    params.flatMap((param) => PARAM_FILTERS[param]?.({ ...context, needed }) ?? []);
  return [...drawn(spec.needs, true), ...drawn(spec.takes ?? [], false)];
}
