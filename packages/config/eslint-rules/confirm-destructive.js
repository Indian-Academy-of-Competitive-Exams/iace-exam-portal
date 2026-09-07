// "Confirm anything that destroys, revokes, grants, or changes what somebody can
// do" (the ui-conventions skill), made mechanical: a screen that CALLS a
// destructive endpoint must render a ConfirmDialog. Matched on the API surface,
// never on wording — the label is what gets reworded, the call does the damage.
// "A toggle asks both ways" is not here and cannot be: nothing static tells a
// toggle from a button, so it stays a review rule where the reader is a person.

/** Method names that destroy, revoke or grant wherever they appear on the client. */
const DESTRUCTIVE_METHODS = new Set([
  'remove',
  'removeMember',
  'moveToSeries',
  'setActive',
  'setTestBlocked',
  'addMembers',
  'clone',
  'revoke',
  'grant',
]);

/** The ones whose damage is in the noun, not the verb — `create` an ADMIN, `create` a GRANT. */
const DESTRUCTIVE_PATHS = new Set([
  'admins.create',
  'grants.create',
  'testSeries.updateBranch',
  'features.grant',
  'features.revoke',
]);

const CONFIRM_DIALOG = 'ConfirmDialog';

/** `api.admin.students.remove` → ['api', 'admin', 'students', 'remove']; null for anything else. */
function memberPath(node) {
  const parts = [];
  let current = node;

  while (current?.type === 'MemberExpression' && !current.computed) {
    if (current.property.type !== 'Identifier') return null;
    parts.unshift(current.property.name);
    current = current.object;
  }

  if (current?.type !== 'Identifier') return null;
  parts.unshift(current.name);
  return parts;
}

function isDestructive(parts) {
  if (parts.length < 2 || parts[0] !== 'api') return false;

  const method = parts.at(-1);
  const pair = parts.slice(-2).join('.');
  return DESTRUCTIVE_METHODS.has(method) || DESTRUCTIVE_PATHS.has(pair);
}

/** @type {import('eslint').Rule.RuleModule} */
export const confirmDestructive = {
  meta: {
    type: 'problem',
    docs: { description: 'A screen calling a destructive endpoint must render a ConfirmDialog.' },
    schema: [],
    messages: {
      noConfirm:
        '`{{call}}` destroys, revokes or grants without asking. Render a ConfirmDialog from @iace/ui naming the consequence and the count.',
    },
  },

  create(context) {
    const calls = [];
    let confirms = false;

    return {
      CallExpression(node) {
        const parts = memberPath(node.callee);
        if (parts && isDestructive(parts)) calls.push({ node, call: parts.join('.') });
      },

      JSXIdentifier(node) {
        if (node.name === CONFIRM_DIALOG) confirms = true;
      },

      'Program:exit'() {
        if (confirms) return;
        for (const { node, call } of calls) {
          context.report({ node, messageId: 'noConfirm', data: { call } });
        }
      },
    };
  },
};

/** The plugin object, for a flat config's `plugins` map. */
export const iaceConfirmPlugin = {
  meta: { name: '@iace/config/confirm' },
  rules: { 'confirm-destructive': confirmDestructive },
};
