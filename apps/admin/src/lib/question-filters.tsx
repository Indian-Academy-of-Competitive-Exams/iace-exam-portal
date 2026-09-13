/**
 * The facets every question-bank screen narrows by, declared once. Proofreading, approvals and the
 * bank itself each built these by hand, and had drifted: two spelled the type labels out inline
 * where the third read QUESTION_TYPE_LABELS.
 */

import { DIFFICULTY_LEVELS, QUESTION_TYPES } from '@iace/contracts';
import { type ListFilterMultiControl } from '@iace/ui';
import { SubjectMultiPicker, TopicMultiPicker } from '../components/taxonomy-picker';
import { QUESTION_TYPE_LABELS } from './constants';

/** Narrow enough that any screen's `useFilters` satisfies it, whatever its own key union. */
interface SubjectCascade {
  set: (values: { subjectId: string; topicId: string }) => void;
}

export function questionFacetFilters(filters: SubjectCascade, subjectIds: string[]) {
  return [
    {
      key: 'subjectId',
      kind: 'customMulti',
      label: 'Subject',
      render: (control: ListFilterMultiControl) => (
        <SubjectMultiPicker
          {...control}
          // A topic under a subject no longer chosen would filter everything away.
          onChange={(value) => filters.set({ subjectId: value.join(','), topicId: '' })}
        />
      ),
    },
    {
      key: 'topicId',
      kind: 'customMulti',
      label: 'Topic',
      render: (control: ListFilterMultiControl) => (
        <TopicMultiPicker {...control} subjectIds={subjectIds} />
      ),
    },
    {
      key: 'difficulty',
      kind: 'multi',
      label: 'Difficulty',
      placeholder: 'Any difficulty',
      items: DIFFICULTY_LEVELS.map((level) => ({ value: level, label: level })),
    },
    {
      key: 'type',
      kind: 'multi',
      label: 'Type',
      placeholder: 'Any type',
      items: QUESTION_TYPES.map((value) => ({ value, label: QUESTION_TYPE_LABELS[value] })),
    },
  ] as const;
}

/** Both are free text: a tag is free text already, and there is no list of authors to offer. */
export const QUESTION_TAG_FILTER = {
  key: 'tag',
  kind: 'search',
  label: 'Tag',
  placeholder: 'Exactly one tag',
} as const;

export const QUESTION_AUTHOR_FILTER = {
  key: 'author',
  kind: 'search',
  label: 'Written by',
  placeholder: 'A name or an email',
} as const;
