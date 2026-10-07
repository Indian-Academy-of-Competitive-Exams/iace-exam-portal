import { PageFrame, PageHeader } from '@iace/ui';
import { PageCrumbs } from '@iace/app-kit/browser';
import { NAV_ITEMS } from '../../lib/constants';
import { PageBody } from '../../components/ui';
import { ActiveDevices } from './active-devices';

/** Where this account is signed in. */
export function AccountPage() {
  return (
    <PageFrame
      header={
        <PageHeader breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />} size="display" title="Account" />
      }
    >
      <PageBody>
        <ActiveDevices />
      </PageBody>
    </PageFrame>
  );
}
