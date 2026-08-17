import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';

const preset = createRequire(import.meta.url)('../tailwind.preset.js') as {
  theme: { extend: { colors: Record<string, unknown> } };
};

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

/** Every declared colour, in the shape Tailwind builds a class from. */
function declaredColours(): Set<string> {
  const names = new Set<string>();
  for (const [key, value] of Object.entries(preset.theme.extend.colors)) {
    if (typeof value === 'function') {
      names.add(key);
      continue;
    }
    for (const sub of Object.keys(value as Record<string, unknown>)) {
      names.add(sub === 'DEFAULT' ? key : `${key}-${sub}`);
    }
  }
  return names;
}

/** The utilities that take a colour. `ring-offset` before `ring` — longest first. */
const COLOUR_UTILITIES = [
  'ring-offset',
  'text',
  'bg',
  'border',
  'ring',
  'fill',
  'stroke',
  'divide',
  'outline',
  'decoration',
  'accent',
  'caret',
  'placeholder',
] as const;

/** Class-ish tokens, split on whitespace. Loose — a false hit is dropped below. */
function classCandidates(source: string): string[] {
  return source.split(/[\s'"`{}()[\],;]+/).filter(Boolean);
}

/** `hover:`, `sm:`, `data-[state=open]:` — strip every variant off the front. */
function stripVariants(candidate: string): string {
  const lastColon = candidate.lastIndexOf(':');
  return lastColon === -1 ? candidate : candidate.slice(lastColon + 1);
}

/** First segment of a hyphenated name — `primary` out of `primary-subtle`. */
const root = (name: string): string => name.split('-')[0] ?? name;

function sharedSourceFiles(): string[] {
  return globSync('packages/*/{src,browser}/**/*.tsx', { cwd: REPO_ROOT }).map((f) =>
    path.resolve(REPO_ROOT, f),
  );
}

/**
 * An unresolvable colour class is not a build error — no CSS is emitted and the element
 * inherits. Scoped to our own roots, where a plausible shade can be invented.
 */
describe('preset colour classes', () => {
  const colours = declaredColours();
  const roots = new Set([...colours].map(root));

  it('declares every colour the shared components ask for', () => {
    const unresolved = new Map<string, string[]>();

    for (const file of sharedSourceFiles()) {
      for (const raw of classCandidates(readFileSync(file, 'utf8'))) {
        const candidate = stripVariants(raw);
        // Arbitrary values (`bg-[--overlay-bg]`) bypass the palette entirely.
        if (candidate.includes('[')) continue;

        const utility = COLOUR_UTILITIES.find((u) => candidate.startsWith(`${u}-`));
        if (!utility) continue;

        // `bg-muted/40` — the opacity modifier is not part of the colour name.
        const colour = candidate.slice(utility.length + 1).split('/')[0] ?? '';
        if (!roots.has(root(colour))) continue;
        if (colours.has(colour)) continue;

        const where = unresolved.get(candidate) ?? [];
        where.push(path.relative(REPO_ROOT, file));
        unresolved.set(candidate, where);
      }
    }

    assert.deepEqual(
      [...unresolved.entries()].map(([cls, files]) => `${cls} (${[...new Set(files)].join(', ')})`),
      [],
      'these name one of our colour roots but a shade the preset never declares, so Tailwind ' +
        'emits nothing for them — declare the shade in packages/ui/tailwind.preset.js',
    );
  });

  it('knows the shade that proved this matters', () => {
    assert.ok(
      colours.has('foreground-secondary'),
      'text-foreground-secondary is used by the app shell and must resolve',
    );
  });
});
