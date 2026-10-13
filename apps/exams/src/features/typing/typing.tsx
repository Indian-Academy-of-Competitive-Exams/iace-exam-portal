/** Typing practice: pick the test, read what it is held to, start, and look back at earlier sessions. */
import { Link } from 'react-router-dom';
import { Keyboard } from 'lucide-react';
import {
  TYPING_PRESETS,
  TYPING_PRESET_KEY,
  TYPING_PRESET_KEYS,
  instituteDateTimeLabel,
  typingPresetKeySchema,
  type TypingMetric,
  type TypingPractice,
  type TypingPreset,
  type TypingPresetKey,
} from '@iace/contracts';
import { PageCrumbs, useFilters, useListScreen } from '@iace/app-kit/browser';
import {
  Badge,
  Button,
  Card,
  Combobox,
  ListView,
  PageFrame,
  PageHeader,
  StatRow,
  type DataTableColumn,
} from '@iace/ui';
import { Hero, PageBody, Section } from '../../components/ui';
import { api } from '../../lib/api';
import { NAV_ITEMS, PICKER_WIDTH, ROUTES, typingPracticesQueryKey } from '../../lib/constants';
import { durationLabel, mistakeRuleLabel } from './typing-figures';
import { headlineOf, mistakesOf, targetLabel } from '@iace/app-kit';

const PRESET_ITEMS = TYPING_PRESET_KEYS.map((key) => ({
  value: key,
  label: TYPING_PRESETS[key].label,
}));
const NO_FILTERS = [] as const;

export function TypingPage() {
  const url = useFilters<'test'>();
  const presetKey: TypingPresetKey =
    typingPresetKeySchema.safeParse(url.get('test')).data ?? TYPING_PRESET_KEY.SSC_CHSL_TYPING_EN;
  const preset = TYPING_PRESETS[presetKey];

  return (
    <PageFrame header={<PageHeader breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />} title="Typing" />}>
      <PageBody>
        <Hero
          eyebrow="Practice"
          title={preset.label}
          meta={`${durationLabel(preset)} · ${targetLabel(preset)}`}
          aside={
            <div className="flex flex-wrap items-end gap-3">
              <Combobox
                aria-label="Test"
                className={PICKER_WIDTH.REPORT}
                clearable={false}
                value={presetKey}
                items={PRESET_ITEMS}
                onChange={(next) => url.set({ test: next })}
              />
              <Button asChild icon={<Keyboard aria-hidden />}>
                <Link to={ROUTES.TYPING_SESSION(presetKey)}>Start typing</Link>
              </Button>
            </div>
          }
        />

        <Section title="Standard">
          <Card className="flex flex-col gap-3 p-5">
            <StatRow label="Duration" value={durationLabel(preset)} />
            <StatRow label="Target" value={targetLabel(preset)} />
            <StatRow label="Mistakes" value={mistakeRuleLabel(preset.rule)} />
            <StatRow label="Backspace" value={preset.backspace ? 'Allowed' : 'Not allowed'} />
          </Card>
        </Section>

        <Section title="History">
          <Card className="flex flex-col gap-4 p-4">
            <History key={presetKey} presetKey={presetKey} preset={preset} />
          </Card>
        </Section>
      </PageBody>
    </PageFrame>
  );
}

function History({
  presetKey,
  preset,
}: Readonly<{ presetKey: TypingPresetKey; preset: TypingPreset }>) {
  const list = useListScreen({
    queryKey: [...typingPracticesQueryKey(), presetKey],
    filters: NO_FILTERS,
    toQuery: () => ({}),
    fetchPage: (params) => api.me.typingPractices({ ...params, presetKey }),
  });

  return (
    <ListView
      list={list}
      columns={historyColumns(preset)}
      rowKey={(row) => row.id}
      empty="No sessions yet"
      stacks
    />
  );
}

/** Short enough to sit two to a line on a phone. A plain count has no rate: its column is the count. */
const HEADLINE_HEADERS: Readonly<Partial<Record<TypingMetric, string>>> = {
  WPM: 'Speed (WPM)',
  KEY_DEPRESSIONS_PER_HOUR: 'Rate (per hour)',
};

function historyColumns(preset: TypingPreset): DataTableColumn<TypingPractice>[] {
  const header = HEADLINE_HEADERS[preset.metric];
  const headline: DataTableColumn<TypingPractice>[] = header
    ? [
        {
          key: 'headline',
          header,
          numeric: true,
          cell: (row) => headlineOf(preset, row).toLocaleString('en-IN'),
        },
      ]
    : [];

  return [
    { key: 'when', header: 'Typed on', cell: (row) => instituteDateTimeLabel(row.createdAt) },
    ...headline,
    {
      key: 'keyDepressions',
      header: 'Key depressions',
      numeric: true,
      cell: (row) => row.keyDepressions.toLocaleString('en-IN'),
    },
    { key: 'mistakes', header: 'Mistakes', numeric: true, cell: mistakesOf },
    { key: 'errorPct', header: 'Errors (%)', numeric: true, cell: (row) => row.errorPct },
    {
      key: 'result',
      header: 'Result',
      cell: (row) => (
        <Badge variant={row.qualified ? 'success' : 'danger'}>
          {row.qualified ? 'Qualified' : 'Not qualified'}
        </Badge>
      ),
    },
  ];
}
