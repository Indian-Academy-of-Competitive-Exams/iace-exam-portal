import {
  REPORT_INACTIVE_DAYS_DEFAULT,
  REPORT_PARAMS,
  REPORT_PERIODS,
  REPORT_TOP_DEFAULT,
  reportPeriodOf,
  type ReportChoiceParam,
  type ReportFact,
  type ReportParam,
  type ReportPeriod,
  type ReportQuery,
  type ReportSpec,
} from '@iace/contracts';
import { Combobox, DatePicker, type ListFilter, type ListFilterControl } from '@iace/ui';
import { REPORT_PARAM_LABELS, REPORT_PERIOD_LABELS } from '../../lib/constants';
import { ReportChoicePicker } from './report-choice-picker';

const TOP_CHOICES = [25, 50, 100] as const;
const DAYS_CHOICES = [7, 30, 60, 90] as const;
const PERIODS: readonly ReportPeriod[] = Object.values(REPORT_PERIODS);

type Field = keyof ReportQuery;

export interface FilterContext {
  /** What the loaded report says it covers, which names a choice the picker has not paged to. */
  about: readonly ReportFact[];
  /** What the report is being read for: the URL's values, and a needed period's own default. */
  fields: Readonly<Partial<Record<Field, string>>>;
  /** Several fields at once, for a control that sets or clears more than its own. */
  set: (changes: Partial<Record<Field, string | undefined>>) => void;
}

type Drawn = (context: FilterContext & { needed: boolean }) => ListFilter[];

const namedIn = (about: readonly ReportFact[], label: string): string | undefined => {
  const value = about.find((fact) => fact.label === label)?.value;
  return typeof value === 'string' ? value : undefined;
};

/** The named period the two dates amount to, or none when they were picked by hand. */
function periodNamed(from: string | undefined, to: string | undefined): ReportPeriod | '' {
  const named = PERIODS.find((period) => {
    const range = reportPeriodOf(period);
    return range.from === from && range.to === to;
  });
  return named ?? '';
}

/** A param picked from a list. A needed one has no "none", so its picker cannot be cleared. */
const picked =
  (param: ReportChoiceParam, field: Field): Drawn =>
  ({ needed, about }) => [
    {
      key: field,
      kind: 'custom',
      label: REPORT_PARAM_LABELS[param],
      render: (control: ListFilterControl) => (
        <ReportChoicePicker
          {...control}
          param={param}
          clearable={!needed}
          selectedLabel={namedIn(about, REPORT_PARAM_LABELS[param])}
        />
      ),
    },
  ];

const PARAM_FILTERS: Record<ReportParam, Drawn> = {
  [REPORT_PARAMS.TEST]: picked(REPORT_PARAMS.TEST, 'testId'),
  [REPORT_PARAMS.SERIES]: picked(REPORT_PARAMS.SERIES, 'seriesId'),
  [REPORT_PARAMS.EVENT]: picked(REPORT_PARAMS.EVENT, 'eventId'),
  [REPORT_PARAMS.BRANCH]: picked(REPORT_PARAMS.BRANCH, 'branchId'),
  // A sitting belongs to its student, so choosing another student lets go of the sitting.
  [REPORT_PARAMS.STUDENT]: ({ about, set }) => [
    {
      key: 'studentId',
      kind: 'custom',
      label: REPORT_PARAM_LABELS[REPORT_PARAMS.STUDENT],
      render: (control: ListFilterControl) => (
        <ReportChoicePicker
          {...control}
          param={REPORT_PARAMS.STUDENT}
          clearable={false}
          selectedLabel={namedIn(about, REPORT_PARAM_LABELS[REPORT_PARAMS.STUDENT])}
          onChange={(studentId) => set({ studentId, attemptId: undefined })}
        />
      ),
    },
  ],
  [REPORT_PARAMS.ATTEMPT]: ({ fields }) => [
    {
      key: 'attemptId',
      kind: 'custom',
      label: REPORT_PARAM_LABELS[REPORT_PARAMS.ATTEMPT],
      render: (control: ListFilterControl) => (
        <ReportChoicePicker
          {...control}
          param={REPORT_PARAMS.ATTEMPT}
          studentId={fields.studentId}
          clearable={false}
        />
      ),
    },
  ],
  // One control that sets two dates, beside the two dates themselves for a period no name fits.
  [REPORT_PARAMS.PERIOD]: ({ fields, set }) => [
    {
      key: 'period',
      kind: 'custom',
      label: REPORT_PARAM_LABELS[REPORT_PARAMS.PERIOD],
      render: (control: ListFilterControl) => (
        <Combobox
          {...control}
          value={periodNamed(fields.from, fields.to)}
          onChange={(named) => set({ ...reportPeriodOf(named as ReportPeriod) })}
          clearable={false}
          placeholder="Custom period"
          items={PERIODS.map((value) => ({ value, label: REPORT_PERIOD_LABELS[value] }))}
        />
      ),
    },
    // A date set by hand writes both ends: a default worked out on each visit would move under a copied link.
    {
      key: 'from',
      kind: 'custom',
      label: 'From',
      render: (control: ListFilterControl) => (
        <DatePicker
          {...control}
          max={fields.to}
          onChange={(from) => set({ from, to: fields.to })}
        />
      ),
    },
    {
      key: 'to',
      kind: 'custom',
      label: 'To',
      render: (control: ListFilterControl) => (
        <DatePicker
          {...control}
          min={fields.from}
          onChange={(to) => set({ from: fields.from, to })}
        />
      ),
    },
  ],
  [REPORT_PARAMS.TOP]: () => [
    {
      key: 'top',
      kind: 'choice',
      label: REPORT_PARAM_LABELS[REPORT_PARAMS.TOP],
      items: [
        { value: '', label: `Top ${REPORT_TOP_DEFAULT}` },
        ...TOP_CHOICES.map((top) => ({ value: String(top), label: `Top ${top}` })),
      ],
    },
  ],
  [REPORT_PARAMS.DAYS]: () => [
    {
      key: 'days',
      kind: 'choice',
      label: REPORT_PARAM_LABELS[REPORT_PARAMS.DAYS],
      items: [
        { value: '', label: `${REPORT_INACTIVE_DAYS_DEFAULT} days` },
        ...DAYS_CHOICES.map((days) => ({ value: String(days), label: `${days} days` })),
      ],
    },
  ],
};

/** What a report is asked through, read off its catalogue row: what it needs, then what narrows it. */
export function reportFilters(spec: ReportSpec, context: FilterContext): ListFilter[] {
  const drawn = (params: readonly ReportParam[], needed: boolean) =>
    params.flatMap((param) => PARAM_FILTERS[param]({ ...context, needed }));
  return [...drawn(spec.needs, true), ...drawn(spec.takes ?? [], false)];
}
