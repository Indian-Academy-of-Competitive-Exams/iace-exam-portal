import { describe, it } from 'node:test';
import { RuleTester } from 'eslint';
import { confirmDestructive } from '../eslint-rules/confirm-destructive.js';

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true }, ecmaVersion: 2022 } },
});

const screen = (body) => `function Screen() { ${body} }`;

ruleTester.run('confirm-destructive', confirmDestructive, {
  valid: [
    // The confirm is in the same screen as the call, which is the whole rule.
    screen('api.admin.students.remove(id); return <ConfirmDialog onConfirm={go} />;'),
    screen('api.admin.admins.create(body); return <ConfirmDialog />;'),
    screen('api.admin.testSeries.updateBranch(id, b, {}); return <><ConfirmDialog /></>;'),

    // Reads and ordinary saves ask nobody.
    screen('api.admin.students.list({}); return <p />;'),
    screen('api.admin.tests.update(id, body); return <p />;'),

    // `remove` on something that is not the API client is not an endpoint.
    screen('const next = new Set(); next.remove(id); return <p />;'),
    screen('queryClient.removeQueries({ queryKey: k }); return <p />;'),
  ],

  invalid: [
    {
      code: screen('api.admin.students.remove(id); return <p />;'),
      errors: [{ messageId: 'noConfirm' }],
    },
    {
      // The damage is in the noun: creating an admin grants somebody the panel.
      code: screen('api.admin.admins.create(body); return <p />;'),
      errors: [{ messageId: 'noConfirm' }],
    },
    {
      code: screen('api.admin.features.revoke(id, key); return <p />;'),
      errors: [{ messageId: 'noConfirm' }],
    },
    {
      code: screen('api.admin.students.setTestBlocked(id, true); return <p />;'),
      errors: [{ messageId: 'noConfirm' }],
    },
    {
      // Every offending call is named, not just the first.
      code: screen('api.admin.a.remove(x); api.admin.b.revoke(y); return <p />;'),
      errors: [{ messageId: 'noConfirm' }, { messageId: 'noConfirm' }],
    },
  ],
});
