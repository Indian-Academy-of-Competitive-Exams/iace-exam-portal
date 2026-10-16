import { adminCatalogClient } from './admin-catalog';
import { adminImportsClient } from './admin-imports';
import { adminOpsClient } from './admin-ops';
import { adminPeopleClient } from './admin-people';
import { adminQuestionsClient } from './admin-questions';
import { adminSectionsClient } from './admin-sections';
import { adminSupportClient } from './admin-support';
import { adminTestsClient } from './admin-tests';
import type { ApiCore } from './core';

export function adminClient(core: ApiCore) {
  return {
    ...adminOpsClient(core),
    ...adminPeopleClient(core),
    ...adminCatalogClient(core),
    ...adminTestsClient(core),
    ...adminQuestionsClient(core),
    ...adminSectionsClient(core),
    ...adminImportsClient(core),
    ...adminSupportClient(core),
  };
}
