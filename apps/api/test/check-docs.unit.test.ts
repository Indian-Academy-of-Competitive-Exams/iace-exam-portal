/**
 * A stale dist/ once made a deleted enum read as live, and a `DROP TABLE "X"` assertion inside a
 * test kept three deleted tables alive in source, so the guard passed while the docs rotted on.
 * Those two exclusions are why this script, unlike its two siblings, is worth a test at all.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  architectureHeadings,
  brokenSectionRefs,
  ghostIdentifiers,
  sourceSymbols,
} from '../../../scripts/check-docs.mjs';

const ALLOWLIST = ['EventEmitter'];
const ARCHITECTURE = 'docs/03-shared-architecture.md';

const doc = (text: string) => [{ path: ARCHITECTURE, text }];
const names = (offences: string[]) => offences.map((offence) => offence.split('  ')[0]);

describe('ghostIdentifiers — a doc may only name what the repo has', () => {
  it('accepts a name the schema defines', () => {
    const offences = ghostIdentifiers({
      docs: doc('A stage holds exactly one default `BaseConfig`.'),
      models: ['BaseConfig'],
      symbols: [],
      allowlist: ALLOWLIST,
    });
    assert.deepEqual(offences, []);
  });

  it('accepts a name only the TypeScript source defines', () => {
    const offences = ghostIdentifiers({
      docs: doc('Route it through `AccessResolverService`.'),
      models: [],
      symbols: ['AccessResolverService'],
      allowlist: ALLOWLIST,
    });
    assert.deepEqual(offences, []);
  });

  it('reports a name that is in neither the schema nor the source', () => {
    const offences = ghostIdentifiers({
      docs: doc('Gated by the `BranchTestConfig` row for their branch.'),
      models: ['BaseConfig'],
      symbols: ['AccessResolverService'],
      allowlist: ALLOWLIST,
    });
    assert.deepEqual(names(offences), ['BranchTestConfig']);
  });

  it('names every doc that cites it, because the output is the rewrite worklist', () => {
    const offences = ghostIdentifiers({
      docs: [
        { path: 'README.md', text: 'the `AdminBranch` join' },
        { path: 'docs/01-architecture-and-plan.md', text: '`AdminBranch` is per admin' },
      ],
      models: [],
      symbols: [],
      allowlist: ALLOWLIST,
    });
    assert.deepEqual(offences, [
      'AdminBranch  cited in docs/01-architecture-and-plan.md, README.md',
    ]);
  });

  it('never reports a single-word name, or every enum value in every doc would fire', () => {
    const offences = ghostIdentifiers({
      docs: doc('`FREE` reaches everyone, and there is no `Feature` table for a `Test`.'),
      models: [],
      symbols: [],
      allowlist: [],
    });
    assert.deepEqual(offences, []);
  });

  it('never reports an allowlisted name', () => {
    const offences = ghostIdentifiers({
      docs: doc('a reaction rides the `EventEmitter`'),
      models: [],
      symbols: [],
      allowlist: ALLOWLIST,
    });
    assert.deepEqual(offences, []);
  });
});

describe('sourceSymbols — what is allowed to prove a name still exists', () => {
  it('takes a symbol from real source', () => {
    const symbols = sourceSymbols([
      { path: 'apps/api/src/tests/tests.service.ts', text: 'export class TestsService {}' },
    ]);
    assert.equal(symbols.has('TestsService'), true);
  });

  it('ignores a test directory, so a DROP TABLE assertion cannot keep a dead table alive', () => {
    const symbols = sourceSymbols([
      {
        path: 'apps/api/test/migration-invariants.unit.test.ts',
        text: 'assert.match(THE_DROP, /DROP TABLE "BranchTestConfig"/);',
      },
    ]);
    assert.equal(symbols.has('BranchTestConfig'), false);

    const offences = ghostIdentifiers({
      docs: doc('the `BranchTestConfig` row for their branch'),
      models: [],
      symbols,
      allowlist: ALLOWLIST,
    });
    assert.deepEqual(names(offences), ['BranchTestConfig']);
  });

  it('ignores a colocated test file too, not only a test directory', () => {
    const symbols = sourceSymbols([
      { path: 'apps/admin/src/lib/access.test.ts', text: 'const row: BranchTestSchedule = x;' },
    ]);
    assert.equal(symbols.has('BranchTestSchedule'), false);
  });

  it('ignores build output, so a stale dist/ cannot keep a deleted name alive', () => {
    const symbols = sourceSymbols([
      {
        path: 'packages/contracts/dist/groups.d.ts',
        text: 'export declare const AdminBranch: string;',
      },
    ]);
    assert.equal(symbols.has('AdminBranch'), false);

    const offences = ghostIdentifiers({
      docs: doc('an `AdminBranch` per admin'),
      models: [],
      symbols,
      allowlist: ALLOWLIST,
    });
    assert.deepEqual(names(offences), ['AdminBranch']);
  });
});

describe('brokenSectionRefs — a docs/03 citation must land on something', () => {
  const headings = architectureHeadings(
    [
      '## 4. Backend module boundaries — the extraction rules',
      '',
      '1. **Public surface only.** A module exposes a facade.',
      '2. **Own your tables.** Each module owns a set of Prisma models.',
      '',
      '## 5. Table-ownership map',
      '',
    ].join('\n'),
  );

  it('resolves a whole-section citation', () => {
    const citations = [{ path: 'apps/api/src/tests/index.ts', section: '5' }];
    assert.deepEqual(brokenSectionRefs({ headings, citations }), []);
  });

  it('resolves a numbered rule, which the doc writes as a list item and not a heading', () => {
    const citations = [{ path: 'apps/api/src/access/index.ts', section: '4.1' }];
    assert.deepEqual(brokenSectionRefs({ headings, citations }), []);
  });

  it('reports a citation with no matching heading, naming the file that made it', () => {
    const citations = [{ path: 'apps/api/src/auth/auth.module.ts', section: '4.9' }];
    assert.deepEqual(brokenSectionRefs({ headings, citations }), [
      'docs/03 §4.9  cited in apps/api/src/auth/auth.module.ts',
    ]);
  });
});
