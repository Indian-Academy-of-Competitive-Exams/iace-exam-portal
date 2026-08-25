import { useQuery } from '@tanstack/react-query';
import {
  DIFFICULTY_LEVELS,
  PAGE_SIZE_MAX,
  QUESTION_STATUS,
  defaultMixFor,
  mixIssue,
  type BaseConfigSection,
  type DifficultyMix,
  type SectionDrawSpec,
} from '@iace/contracts';
import { Checkbox, Field, RatioBar, type RatioPart, type RatioValues } from '@iace/ui';
import { api } from '../lib/api';
import { TopicMultiPicker } from './taxonomy-picker';

/** What one section is drawn from: its topics, and how many of each difficulty. */

const PARTS: readonly [RatioPart, RatioPart, RatioPart] = [
  { key: 'LOW', label: 'Low', className: 'bg-success' },
  { key: 'MEDIUM', label: 'Medium', className: 'bg-warning' },
  { key: 'HIGH', label: 'High', className: 'bg-destructive' },
];

const asValues = (mix: DifficultyMix): RatioValues => [mix.LOW, mix.MEDIUM, mix.HIGH];
const asMix = ([LOW, MEDIUM, HIGH]: RatioValues): DifficultyMix => ({ LOW, MEDIUM, HIGH });

export function DrawSpecEditor({
  section,
  spec,
  onChange,
  disabled,
}: Readonly<{
  section: BaseConfigSection;
  spec: SectionDrawSpec;
  onChange: (next: SectionDrawSpec) => void;
  disabled?: boolean;
}>) {
  const topicIds = spec.topicIds ?? [];

  /** What the bank actually holds for this section, so a thin bucket shows while it is being set. */
  const available = useQuery({
    queryKey: ['admin', 'questions', 'available', section.subjectId, topicIds.join(',')],
    queryFn: () =>
      api.admin.questions.list({
        page: 1,
        pageSize: PAGE_SIZE_MAX,
        status: [QUESTION_STATUS.ACTIVE],
        subjectId: section.subjectId ? [section.subjectId] : undefined,
        topicId: topicIds.length > 0 ? topicIds : undefined,
      }),
    enabled: section.subjectId !== null,
  });

  const held = new Map(
    DIFFICULTY_LEVELS.map((level) => [
      level,
      (available.data?.items ?? []).filter((question) => question.difficulty === level).length,
    ]),
  );

  const issue = spec.mix ? mixIssue(spec.mix, { ...section, id: section.id }) : null;

  return (
    <div className="flex flex-col gap-4">
      <Field
        htmlFor={`topics-${section.id}`}
        label="Topics"
        hint="Leave empty to draw from the whole subject"
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
            {DIFFICULTY_LEVELS.map(
              (level) => `${held.get(level) ?? 0} ${level.toLowerCase()}`,
            ).join(' · ')}
            {' in the bank'}
          </p>

          {issue ? <p className="text-sm text-destructive">{issue}</p> : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {`${available.data?.total ?? 0} questions in the bank for this section.`}
        </p>
      )}
    </div>
  );
}
