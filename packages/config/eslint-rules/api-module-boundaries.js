// The module-boundary rule from docs/03 §4.1 and §12, made mechanical.
//
// A backend module is a bounded context, and the reason boundaries are policed
// now rather than at extraction time is that the failure is silent: nothing
// breaks when `groups` reaches into `../branches/branch-rules`, it just quietly
// stops being possible to lift `branches` into its own service without
// rewriting the caller. By the time that matters there are twenty such imports
// and no one remembers which were deliberate.
//
// So a sibling module is reachable only through its PUBLIC ENTRY — its
// `<module>.module.ts` or an `index.ts` barrel — and everything else in it is
// private. Infra is exempt: `prisma`, `redis`, `queue`, `storage`, `config` and
// `common` are shared libraries every service links, not services themselves
// (§4.4), so importing them freely is the design rather than a leak.
import path from 'node:path';

/**
 * Shared libraries, not bounded contexts. These never become services, so a
 * deep import into one costs nothing at extraction time.
 */
const DEFAULT_INFRA = ['common', 'config', 'prisma', 'queue', 'redis', 'storage'];

/** Extensions a TS import may omit. */
const OPTIONAL_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs'];

const SRC_SEGMENT = `${path.sep}src${path.sep}`;

/**
 * Everything after `<root>/src/`, split into segments — or null for a file that
 * is not under a `src` directory at all (a config file, a test).
 */
function segmentsUnderSrc(filename) {
  const index = filename.lastIndexOf(SRC_SEGMENT);
  if (index === -1) return null;
  return filename.slice(index + SRC_SEGMENT.length).split(path.sep);
}

function stripExtension(specifierPath) {
  const extension = OPTIONAL_EXTENSIONS.find((candidate) => specifierPath.endsWith(candidate));
  return extension ? specifierPath.slice(0, -extension.length) : specifierPath;
}

/**
 * `apps/api/src` module boundaries: no deep sibling imports.
 *
 * @type {import('eslint').Rule.RuleModule}
 */
export const apiModuleBoundaries = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'A module folder may only import a sibling module through its public entry (docs/03 §4).',
    },
    schema: [
      {
        type: 'object',
        properties: {
          infra: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      deepImport:
        "'{{specifier}}' reaches inside the '{{target}}' module. Import its public entry " +
        "('../{{target}}' or '../{{target}}/{{target}}.module') and add what you need to it — " +
        'a module is a bounded context (docs/03 §4).',
    },
  },

  create(context) {
    const infra = new Set(context.options[0]?.infra ?? DEFAULT_INFRA);
    const filename = context.filename;

    const segments = segmentsUnderSrc(filename);
    // Files sitting directly in `src/` are the composition root — `app.module`
    // wires every module together by definition, and `main` boots it. They are
    // allowed to see everything; that is what a composition root is for.
    if (!segments || segments.length < 2) return {};

    const ownModule = segments[0];
    const sourceDir = path.dirname(filename);

    function check(node) {
      const specifier = node.source?.value;
      if (typeof specifier !== 'string' || !specifier.startsWith('.')) return;

      const resolvedSegments = segmentsUnderSrc(path.resolve(sourceDir, specifier) + path.sep);
      if (!resolvedSegments) return;

      const [target, ...rest] = resolvedSegments.filter(Boolean);
      if (!target || target === ownModule || infra.has(target)) return;

      // The public entry, in the two shapes a Nest module has one: the barrel
      // (`../branches` → index.ts) and the module file (`../auth/auth.module`).
      const inner = stripExtension(rest.join('/'));
      if (inner === '' || inner === 'index' || inner === `${target}.module`) return;

      context.report({ node: node.source, messageId: 'deepImport', data: { specifier, target } });
    }

    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
    };
  },
};

/** The plugin object, for a flat config's `plugins` map. */
export const iaceBoundariesPlugin = {
  meta: { name: '@iace/config/boundaries' },
  rules: { 'api-module-boundaries': apiModuleBoundaries },
};
