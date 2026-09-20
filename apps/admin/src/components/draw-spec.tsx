import { useQuery } from '@tanstack/react-query';
import {
  DIFFICULTY_LEVELS,
  defaultMixFor,
  mixIssue,
  type BaseConfigSection,
  type DifficultyMix,
  type SectionDrawSpec,
} from '@iace/contracts';
import { Checkbox, Field, RatioBar, type RatioPart, type RatioValues } from '@iace/ui';
import { api } from '../lib/api';
import { TopicMultiPicker } from './taxonomy-picker';
import { QUERY_KEYS } from '../lib/constants';

/** What one section is drawn from: its topics, and how many of each difficulty. */

const PARTS: readonly [RatioPart, RatioPart, RatioPart] = [
  { key: 'LOW', label: 'Low', className: 'bg-success' },
  { key: 'MEDIUM', label: 'Medium', className: 'bg-warning' },
  { key: 'HIGH', label: 'High', className: 'bg-destructive' },
];

const asValues = (mix: DifficultyMix): RatioValues => [mix.LOW, mix.MEDIUM, mix.HIGH];
const asMix = ([LOW, MEDIUM, HIGH]: RatioValues): DifficultyMix => ({ LOW, MEDIUM, HIGH });

export function DrawSpecEditor({
  testId,
  section,
  spec,
  onChange,
  disabled,
}: Readonly<{
  testId: string;
  section: BaseConfigSection;
  spec: SectionDrawSpec;
  onChange: (next: SectionDrawSpec) => void;
  disabled?: boolean;
}>) {
  const topicIds = spec.topicIds ?? [];

  /** What the draw itself would find, counted by the database — not everything the bank holds. */
  const available = useQuery({
    queryKey: [...QUERY_KEYS.QUESTIONS, 'available', testId, section.subjectId, topicIds.join(',')],
    queryFn: () =>
      api.admin.questions.availability({
        subjectId: section.subjectId ? [section.subjectId] : undefined,
        topicId: topicIds.length > 0 ? topicIds : undefined,
        forTestId: testId,
      }),
    enabled: section.subjectId !== null,
  });

  const held = available.data?.byDifficulty ?? {};

  const issue = spec.mix ? mixIssue(spec.mix, { ...section, id: section.id }) : null;

  return (
    <div className="flex flex-col gap-4">
      <Field
        htmlFor={`topics-${section.id}`}
        label="Topics"
        /* ui-copy-ok: rule */ hint="Leave empty to draw from the whole subject"
      >
        {(control) => (
          <TopicMultiPicker
            {...control}
            subjectIds={section.subjectId ? [section.subjectId] : []}
            value={topicIds}
            onChange={(next) => onChange({ ...spec, topicIds: next.length > 0 ? next : undefined })}
          />
        )}
      </Field>

      <Checkbox
        label="Group by difficulty"
        checked={spec.mix !== undefined}
        disabled={disabled}
        onChange={(event) =>
          onChange({
            ...spec,
            mix: event.target.checked ? defaultMixFor(section.questionCount) : undefined,
          })
        }
      />

      {spec.mix ? (
        <div className="flex flex-col gap-2">
          <RatioBar
            parts={PARTS}
            values={asValues(spec.mix)}
            total={section.questionCount}
            disabled={disabled}
            onChange={(next) => onChange({ ...spec, mix: asMix(next) })}
          />

          <p className="text-sm text-muted-foreground">
            {DIFFICULTY_LEVELS.map((level) => `${held[level] ?? 0} ${level.toLowerCase()}`).join(
              ' · ',
            )}
            {' to draw from'}
          </p>

          {issue ? <p className="text-sm text-destructive">{issue}</p> : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {`${available.data?.total ?? 0} questions this section can draw from.`}
        </p>
      )}
    </div>
  );
}
