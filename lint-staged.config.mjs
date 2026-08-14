/**
 * The pre-commit gate (docs/03 §11). CI is the backstop, not the first line —
 * a red pipeline you find out about ten minutes after pushing is a worse
 * version of a check that takes five seconds before the commit exists.
 *
 * Formatting runs PER FILE, because prettier is a per-file tool.
 *
 * Lint and typecheck do not, and cannot. ESLint's flat config resolves from the
 * working directory rather than by walking up from each file, and this repo has
 * one config per package and none at the root — `eslint apps/api/src/x.ts` from
 * here simply finds nothing to apply. `tsc -p` is worse: a project's types are
 * a property of the whole project, and checking three staged files in isolation
 * would miss exactly the errors a rename causes elsewhere. So both run through
 * turbo across the workspace, which is cached: the packages you did not touch
 * are a cache hit, and the ones you did were going to be rechecked anyway.
 */
export default {
  '*.{ts,tsx,js,jsx,mjs,cjs,json,css,md,yml,yaml}': ['prettier --write'],

  // Prisma's own formatter, for the one file prettier does not understand.
  // Same bargain as prettier --write: it fixes rather than complains, and
  // lint-staged re-stages what it changed.
  '*.prisma': () => 'pnpm exec prisma format --schema prisma/schema.prisma',

  '*.{ts,tsx}': () => ['pnpm lint', 'pnpm typecheck'],
};
