import { useQuery } from '@tanstack/react-query';
import { type AssignmentRole } from '@iace/contracts';
import { usePagedPicker } from '@iace/app-kit';
import { Combobox } from '@iace/ui';
import { api } from '../lib/api';
import { QUERY_KEYS, QUERY_SCOPES } from '../lib/constants';
import { type PickerProps } from './picker-props';

/** Test -> section, the pair an assignment keys on: the tests page and search, the sections do not. */

/** Which sections the two controls are about — one role's, and whose. */
export interface AssignmentScope {
  role?: AssignmentRole;
  mine?: boolean;
}

const asQuery = (scope: AssignmentScope) => ({
  role: scope.role,
  mine: scope.mine ? ('true' as const) : undefined,
});

const scopeKey = (scope: AssignmentScope) => `${scope.role ?? ''}:${scope.mine ?? false}`;

export function AssignmentTestPicker({
  scope,
  ...props
}: Readonly<PickerProps & { scope: AssignmentScope }>) {
  const tests = usePagedPicker({
    queryKey: [...QUERY_KEYS.ASSIGNMENTS, QUERY_SCOPES.FILTER, 'tests', scopeKey(scope)],
    fetchPage: (params) => api.admin.assignments.tests({ ...params, ...asQuery(scope) }),
  });

  return (
    <Combobox
      {...props}
      {...tests.paging}
      placeholder={props.placeholder ?? 'Any test'}
      items={tests.items.map((test) => ({
        value: test.id,
        label: test.title ?? 'Untitled test',
      }))}
      searchPlaceholder="Search tests"
      emptyLabel="No test matches that"
    />
  );
}

/** Nothing is disabled for the sake of it: without a test there is no list of sections to offer. */
export function AssignmentSectionPicker({
  scope,
  testId,
  ...props
}: Readonly<PickerProps & { scope: AssignmentScope; testId: string }>) {
  const sections = useQuery({
    queryKey: [...QUERY_KEYS.ASSIGNMENTS, QUERY_SCOPES.FILTER, 'sections', testId, scopeKey(scope)],
    queryFn: () => api.admin.assignments.sectionsOf(testId, asQuery(scope)),
    enabled: testId !== '',
  });

  return (
    <Combobox
      {...props}
      isLoading={sections.isPending && testId !== ''}
      disabled={props.disabled === true || testId === ''}
      placeholder={testId === '' ? 'Choose a test first' : (props.placeholder ?? 'Any section')}
      items={(sections.data ?? []).map((section) => ({
        value: section.id,
        label: section.name,
      }))}
      emptyLabel="No section on that test"
    />
  );
}
