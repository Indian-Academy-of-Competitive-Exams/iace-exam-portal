import { useState } from 'react';
import { Plus } from 'lucide-react';
import { FEATURE_KEYS, PERMISSION_LEVELS } from '@iace/contracts';
import { Button, PageHeader, TableFrame } from '@iace/ui';
import { PageCrumbs, useFilters } from '@iace/app-kit/browser';
import { useAuth } from '../providers/auth';
import { COHORT_TABS, NAV_ITEMS, type CohortTab } from '../lib/constants';
import { ProgramsList } from './programs';
import { EventsList } from './events';

const TAB_KEY = 'tab';

/** Two ways a series reaches a cohort, read in the same sitting: one nav row, a tab each. */
export function CohortsPage() {
  const { identity: admin, can } = useAuth();
  const filters = useFilters<typeof TAB_KEY>();
  const [creating, setCreating] = useState(false);

  const tab: CohortTab =
    filters.get(TAB_KEY) === COHORT_TABS.EVENTS ? COHORT_TABS.EVENTS : COHORT_TABS.PROGRAMS;

  const onPrograms = tab === COHORT_TABS.PROGRAMS;
  // A program is catalog a super admin owns; an event is a roster anyone managing students keeps.
  const canCreate = onPrograms
    ? (admin?.isSuperAdmin ?? false)
    : can(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE);

  const header = (
    <PageHeader
      breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
      title="Programs and events"
      action={
        canCreate ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            {onPrograms ? 'New program' : 'New event'}
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <TableFrame
      header={header}
      tabs={{
        value: tab,
        onValueChange: (next) => {
          setCreating(false);
          filters.set({ [TAB_KEY]: next === COHORT_TABS.PROGRAMS ? undefined : next });
        },
        items: [
          {
            value: COHORT_TABS.PROGRAMS,
            label: 'Programs',
            content: <ProgramsList creating={creating} onCreatingChange={setCreating} />,
          },
          {
            value: COHORT_TABS.EVENTS,
            label: 'Events',
            content: <EventsList creating={creating} onCreatingChange={setCreating} />,
          },
        ],
      }}
    />
  );
}
