// The live-test scaling invariant (CLAUDE.md), made mechanical: "Autosave answers
// to Redis every ~20-30s. Never write Postgres per keystroke." At 4-5K concurrent
// sitters a single Postgres write on the answer path is thousands of writes a
// minute against the one resource the sitting cannot lose. The failure is invisible
// in review and in staging — it only shows up as saturation on exam day — so the
// path is fenced here instead. The flusher owns persistence; this owns nothing.

/** Prisma calls that reach Postgres to CHANGE it. `$transaction` and raw execution count. */
const WRITES = new Set([
  'create',
  'createMany',
  'delete',
  'deleteMany',
  'update',
  'updateMany',
  'upsert',
  '$executeRaw',
  '$executeRawUnsafe',
  '$transaction',
]);

/** `this.prisma.attemptQuestion.updateMany` → ['this','prisma','attemptQuestion','updateMany']. */
function memberPath(node) {
  const parts = [];
  let current = node;

  while (current?.type === 'MemberExpression' && !current.computed) {
    if (current.property.type !== 'Identifier') return null;
    parts.unshift(current.property.name);
    current = current.object;
  }

  if (current?.type === 'ThisExpression') return ['this', ...parts];
  if (current?.type === 'Identifier') return [current.name, ...parts];
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
export const noHotPathDbWrite = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'The live answer path is Redis-only; Postgres persistence belongs to the flusher.',
    },
    schema: [],
    messages: {
      hotPathWrite:
        "'{{call}}' writes Postgres on the live answer path, which is Redis-only — at 5K sitters this is thousands of writes a minute. Autosave to Redis and let the flusher persist (CLAUDE.md, scaling-rules).",
    },
  },

  create(context) {
    /** `$executeRaw` is normally a TAGGED TEMPLATE, so the callee is reached two ways. */
    const check = (node, callee) => {
      const parts = memberPath(callee);
      if (!parts) return;

      const method = parts.at(-1);
      if (!WRITES.has(method)) return;

      const base = parts[0] === 'this' ? parts[1] : parts[0];
      if (base !== 'prisma') return;

      context.report({ node, messageId: 'hotPathWrite', data: { call: parts.join('.') } });
    };

    return {
      CallExpression: (node) => check(node, node.callee),
      TaggedTemplateExpression: (node) => check(node, node.tag),
    };
  },
};

/** The plugin object, for a flat config's `plugins` map. */
export const iaceHotPathPlugin = {
  meta: { name: '@iace/config/hot-path' },
  rules: { 'no-hot-path-db-write': noHotPathDbWrite },
};
