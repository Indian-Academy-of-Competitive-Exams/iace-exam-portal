import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NAV_INLINE_MAX_ITEMS,
  NAV_LAYOUT,
  filterNavByPermission,
  isNavItemActive,
  isNavSection,
  resolveNavLayout,
  type NavItem,
} from '../src/nav';

const leaf = (label: string, extra: Partial<NavItem> = {}): NavItem => ({ label, ...extra });
const kids = (n: number): NavItem[] =>
  Array.from({ length: n }, (_, i) => leaf(`child ${i}`, { to: `/c${i}` }));

describe('resolveNavLayout', () => {
  it('keeps a small section inline and pushes a big one into a panel', () => {
    // Both boundaries, so a change to the threshold has to be deliberate.
    assert.equal(
      resolveNavLayout(leaf('s', { children: kids(NAV_INLINE_MAX_ITEMS) })),
      NAV_LAYOUT.INLINE,
    );
    assert.equal(
      resolveNavLayout(leaf('s', { children: kids(NAV_INLINE_MAX_ITEMS + 1) })),
      NAV_LAYOUT.PANEL,
    );
  });

  it('lets an explicit layout beat the count in both directions', () => {
    assert.equal(
      resolveNavLayout(leaf('s', { children: kids(20), layout: NAV_LAYOUT.INLINE })),
      NAV_LAYOUT.INLINE,
    );
    assert.equal(
      resolveNavLayout(leaf('s', { children: kids(1), layout: NAV_LAYOUT.PANEL })),
      NAV_LAYOUT.PANEL,
    );
  });

  it('treats an explicit AUTO exactly like no layout at all', () => {
    const children = kids(NAV_INLINE_MAX_ITEMS + 1);
    assert.equal(
      resolveNavLayout(leaf('s', { children, layout: NAV_LAYOUT.AUTO })),
      resolveNavLayout(leaf('s', { children })),
    );
  });

  it('answers for a leaf rather than making the caller check first', () => {
    assert.equal(resolveNavLayout(leaf('x', { to: '/x' })), NAV_LAYOUT.INLINE);
    assert.equal(isNavSection(leaf('x', { to: '/x' })), false);
    assert.equal(isNavSection(leaf('s', { children: kids(1) })), true);
    // An empty children array is not a section — it has nothing to open.
    assert.equal(isNavSection(leaf('s', { children: [] })), false);
  });
});

describe('filterNavByPermission', () => {
  const nav: NavItem[] = [
    leaf('Open', { to: '/open' }),
    leaf('Gated', { to: '/gated', featureKey: 'TESTS' }),
    leaf('Section', {
      children: [
        leaf('Allowed', { to: '/a', featureKey: 'STUDENTS' }),
        leaf('Denied', { to: '/b', featureKey: 'TESTS' }),
      ],
    }),
  ];

  it('filters at every depth, not just the top', () => {
    const out = filterNavByPermission(nav, (key) => key === 'STUDENTS');

    assert.deepEqual(
      out.map((i) => i.label),
      ['Open', 'Section'],
    );
    assert.deepEqual(
      out[1]?.children?.map((c) => c.label),
      ['Allowed'],
    );
  });

  it('drops a section whose children all went, rather than leaving a dead heading', () => {
    // A heading that opens onto nothing reads as broken, not as absent.
    const out = filterNavByPermission(nav, () => false);
    assert.deepEqual(
      out.map((i) => i.label),
      ['Open'],
    );
  });

  it('keeps an emptied section that is itself a destination', () => {
    const out = filterNavByPermission(
      [leaf('Hub', { to: '/hub', children: [leaf('x', { to: '/x', featureKey: 'NOPE' })] })],
      () => false,
    );
    assert.deepEqual(
      out.map((i) => i.label),
      ['Hub'],
    );
    assert.deepEqual(out[0]?.children, []);
  });

  it('filters nothing when no `can` is supplied', () => {
    // An app that never opted in must not lose its nav when a featureKey appears.
    assert.deepEqual(
      filterNavByPermission(nav).map((i) => i.label),
      ['Open', 'Gated', 'Section'],
    );
  });

  it('does not mutate the input', () => {
    const before = JSON.stringify(nav);
    filterNavByPermission(nav, () => false);
    assert.equal(JSON.stringify(nav), before);
  });
});

describe('isNavItemActive', () => {
  const section = leaf('Students', {
    children: [leaf('All', { to: '/students' }), leaf('Import', { to: '/students/import' })],
  });

  it('marks a collapsed section current when a child route is open', () => {
    // Otherwise the sidebar shows nothing highlighted while you are plainly on
    // one of its pages, which reads as having lost your place.
    assert.equal(isNavItemActive(section, '/students/import'), true);
  });

  it('matches a nested path under a leaf, but not a sibling with the same prefix', () => {
    assert.equal(isNavItemActive(leaf('S', { to: '/students' }), '/students/42'), true);
    assert.equal(isNavItemActive(leaf('S', { to: '/students' }), '/students-archive'), false);
  });

  it('is false when nothing under it matches', () => {
    assert.equal(isNavItemActive(section, '/groups'), false);
  });
});
