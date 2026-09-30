import { useFilters } from '@iace/app-kit/browser';
import { type ListFilterControl } from '@iace/ui';
import {
  AssignmentSectionPicker,
  AssignmentTestPicker,
  type AssignmentScope,
} from './assignment-scope-picker';
import { chooseTest } from '../../lib/assignment-filters';

/** Test, then one of its sections: two filters that cascade, so a new test drops the old section. */
export function useTestSectionFilters(scope: AssignmentScope) {
  const urlFilters = useFilters<'testId' | 'baseConfigSectionId'>();
  const testId = urlFilters.get('testId');
  const sectionId = urlFilters.get('baseConfigSectionId');

  return [
    {
      key: 'testId',
      kind: 'custom',
      label: 'Test',
      primary: true,
      render: (control: ListFilterControl) => (
        <AssignmentTestPicker
          {...control}
          scope={scope}
          onChange={(value) => urlFilters.set(chooseTest(value, testId, sectionId))}
        />
      ),
    },
    {
      key: 'baseConfigSectionId',
      kind: 'custom',
      label: 'Section',
      primary: true,
      render: (control: ListFilterControl) => (
        <AssignmentSectionPicker {...control} scope={scope} testId={testId} />
      ),
    },
  ] as const;
}
