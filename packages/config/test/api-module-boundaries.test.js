import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RuleTester } from 'eslint';
import { apiModuleBoundaries } from '../eslint-rules/api-module-boundaries.js';
import noDom from '../eslint.no-dom.js';

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester();

const file = (relative) => `/repo/apps/api/src/${relative}`;

ruleTester.run('api-module-boundaries', apiModuleBoundaries, {
  valid: [
    // Infra is a shared library every service links, not a bounded context.
    {
      code: "import { PrismaService } from '../prisma/prisma.service';",
      filename: file('me/me.service.ts'),
    },
    {
      code: "import { redisKeys } from '../../redis/redis.keys';",
      filename: file('auth/pin/pin.service.ts'),
    },
    {
      code: "import { Public } from '../common/security/decorators';",
      filename: file('groups/groups.controller.ts'),
    },

    // A module's own internals are its own business.
    {
      code: "import { PinService } from './pin/pin.service';",
      filename: file('auth/auth.service.ts'),
    },
    {
      code: "import { IS_PUBLIC_KEY } from '../decorators';",
      filename: file('auth/guards/jwt-auth.guard.ts'),
    },

    // The two shapes of a public entry.
    { code: "import { AuthService } from '../auth';", filename: file('me/me.controller.ts') },
    {
      code: "import { AuthModule } from '../auth/auth.module';",
      filename: file('imports/imports.module.ts'),
    },

    // The composition root sits directly in src/ and wires everything by
    // definition — it is exempt, not excused.
    {
      code: "import { PinService } from './auth/pin/pin.service';",
      filename: file('app.module.ts'),
    },

    // Package imports are not this rule's business.
    {
      code: "import { AppException } from '@iace/contracts';",
      filename: file('groups/groups.service.ts'),
    },

    // Neither are files outside a src tree.
    {
      code: "import { PinService } from '../src/auth/pin/pin.service';",
      filename: '/repo/apps/api/test/auth-pin.unit.test.ts',
    },
  ],

  invalid: [
    {
      code: "import { PinService } from '../auth/pin/pin.service';",
      filename: file('imports/imports.service.ts'),
      errors: [
        { messageId: 'deepImport', data: { specifier: '../auth/pin/pin.service', target: 'auth' } },
      ],
    },
    {
      code: "import { INACTIVE_BRANCH_MESSAGE } from '../branches/branch-rules';",
      filename: file('groups/groups.service.ts'),
      errors: [{ messageId: 'deepImport' }],
    },
    {
      // Depth is irrelevant — one level in is already inside.
      code: "import { StudentsService } from '../students/students.service';",
      filename: file('me/me.service.ts'),
      errors: [{ messageId: 'deepImport' }],
    },
    {
      // A re-export is an import wearing a hat.
      code: "export { isProfileCompleted } from '../students/student-flags';",
      filename: file('me/index.ts'),
      errors: [{ messageId: 'deepImport' }],
    },
    {
      code: "export * from '../auth/token.service';",
      filename: file('me/index.ts'),
      errors: [{ messageId: 'deepImport' }],
    },
  ],
});

/**
 * The DOM gate is built-in ESLint rules under a shared config, so there is no
 * rule logic to test — only the list, which is the thing a well-meaning edit
 * would shorten. Asserted here so dropping `sessionStorage` from it is a
 * failing test rather than a silently narrower guarantee.
 */
describe('eslint-no-dom', () => {
  it('refuses every browser global app-kit could reach for', () => {
    const [block] = noDom;
    const globals = block.rules['no-restricted-globals'].slice(1).map((entry) => entry.name);
    const properties = block.rules['no-restricted-properties'].slice(1);

    assert.deepEqual(globals, ['window', 'document', 'localStorage', 'sessionStorage']);
    assert.deepEqual(
      properties.map((entry) => entry.property),
      globals,
    );
    assert.ok(properties.every((entry) => entry.object === 'globalThis'));
  });
});
