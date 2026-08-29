import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FEATURE_KEYS } from '@iace/contracts';
import {
  NAV_INLINE_MAX_ITEMS,
  NAV_LAYOUT,
  filterNavBy,
  filterNavByPermission,
  activeNavPath,
  isNavItemActive,
  isNavSection,
  navTrail,
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
    leaf('Gated', { to: '/gated', featureKey: FEATURE_KEYS.TEST_MANAGEMENT }),
    leaf('Section', {
      children: [
        leaf('Allowed', { to: '/a', featureKey: FEATURE_KEYS.STUDENT_MANAGEMENT }),
        leaf('Denied', { to: '/b', featureKey: FEATURE_KEYS.TEST_MANAGEMENT }),
      ],
    }),
  ];

  it('filters at every depth, not just the top', () => {
    const out = filterNavByPermission(nav, (key) => key === FEATURE_KEYS.STUDENT_MANAGEMENT);

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
      [
        leaf('Hub', {
          to: '/hub',
          children: [leaf('x', { to: '/x', featureKey: FEATURE_KEYS.QUESTION_MANAGEMENT })],
        }),
      ],
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

describe('activeNavPath', () => {
  const nav = [
    leaf('Home', { to: '/' }),
    leaf('Students', {
      children: [
        leaf('All students', { to: '/students' }),
        leaf('Import students', { to: '/students/import' }),
        leaf('Groups', { to: '/groups' }),
      ],
    }),
    leaf('Questions', {
      children: [
        leaf('All questions', { to: '/questions' }),
        leaf('Subjects and topics', { to: '/questions/taxonomy' }),
      ],
    }),
  ];

  /**
   * The failure this exists to prevent: a route that EXTENDS a sibling's left both lit, because a
   * prefix match cannot tell "a page under All students" from "the Import students page".
   */
  it('picks the most specific entry, not every entry the path starts with', () => {
    assert.equal(activeNavPath(nav, '/students/import'), '/students/import');
    assert.equal(activeNavPath(nav, '/questions/taxonomy'), '/questions/taxonomy');
  });

  it('still marks the parent for a route no entry owns', () => {
    // A student's detail page has no nav row of its own, so "All students" is
    // the honest answer rather than nothing at all.
    assert.equal(activeNavPath(nav, '/students/stu_42'), '/students');
  });

  it('matches a whole segment, never half of one', () => {
    assert.equal(activeNavPath(nav, '/students-archive'), undefined);
  });

  it('leaves root to an exact match, so it never wins over a real page', () => {
    assert.equal(activeNavPath(nav, '/'), '/');
    assert.equal(activeNavPath(nav, '/groups'), '/groups');
  });

  it('is undefined when the path is outside the nav entirely', () => {
    assert.equal(activeNavPath(nav, '/exam-types'), undefined);
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

  it('takes the resolved path, so a section lights only for the row that won', () => {
    assert.equal(isNavItemActive(section, '/students'), true);
    assert.equal(isNavItemActive(leaf('S', { to: '/students' }), '/students'), true);
    assert.equal(isNavItemActive(leaf('S', { to: '/students' }), '/students/import'), false);
  });

  it('is false when nothing is active at all', () => {
    assert.equal(isNavItemActive(section, undefined), false);
  });

  it('is false when nothing under it matches', () => {
    assert.equal(isNavItemActive(section, '/groups'), false);
  });
});

describe('navTrail', () => {
  const NAV: NavItem[] = [
    {
      label: 'Students',
      children: [
        { to: '/students', label: 'All students' },
        { to: '/students/import', label: 'Import students' },
      ],
    },
    { to: '/audit', label: 'Audit log' },
  ];

  it('names the section above the screen', () => {
    assert.deepEqual(navTrail(NAV, '/students'), [
      { label: 'Students' },
      { label: 'All students', to: '/students' },
    ]);
  });

  /** Without this the trail had no linkable ancestor, so mobile rendered no back link at all. */
  it('points a section at the first screen it holds', () => {
    assert.deepEqual(navTrail(NAV, '/students/import')[0], {
      label: 'Students',
      to: '/students',
    });
  });

  it('always leaves something to go back to', () => {
    const trail = navTrail(NAV, '/students/import');
    assert.ok(trail.slice(0, -1).some((crumb) => crumb.to !== undefined));
  });

  /** A link to the page you are on is a dead link, and a back arrow that goes nowhere. */
  it('does not point an ancestor at the current page', () => {
    assert.equal(navTrail(NAV, '/students')[0]?.to, undefined);
  });

  /** A trail built by prefix would name `/students` an ancestor of `/students/import`. */
  it('follows the deepest match, not a sibling whose route is a prefix', () => {
    assert.deepEqual(navTrail(NAV, '/students/import').at(-1), {
      label: 'Import students',
      to: '/students/import',
    });
  });

  /** One crumb is the page you are on, which the title already says. */
  it('says nothing for a top-level screen', () => {
    assert.deepEqual(navTrail(NAV, '/audit'), []);
  });

  it('says nothing for a route the nav does not own', () => {
    assert.deepEqual(navTrail(NAV, '/nowhere'), []);
  });

  /** A record route hangs off its list, so the trail is the list's. */
  it('resolves a detail route to the row it extends', () => {
    assert.deepEqual(navTrail(NAV, '/students/stu_1').at(-1), {
      label: 'All students',
      to: '/students',
    });
  });
});

describe('filterNavBy', () => {
  const NAV: NavItem[] = [
    {
      label: 'Students',
      children: [leaf('All students', { to: '/students' }), leaf('Exams', { to: '/exams' })],
    },
    { label: 'Audit', children: [leaf('Activity', { to: '/audit' })] },
  ];

  it('drops the rows the rule hides and keeps the rest', () => {
    const kept = filterNavBy(NAV, (item) => item.to === '/exams');

    assert.deepEqual(
      kept[0]?.children?.map((child) => child.to),
      ['/students'],
    );
  });

  /** A section whose every child went is a heading over nothing. */
  it('drops a section once its last child goes', () => {
    const kept = filterNavBy(NAV, (item) => item.to === '/audit');

    assert.deepEqual(
      kept.map((item) => item.label),
      ['Students'],
    );
  });

  /** A section that is itself a destination stays, children or not. */
  it('keeps an emptied section that is a destination of its own', () => {
    const withLink: NavItem[] = [
      { label: 'Tests', to: '/tests', children: [leaf('Series', { to: '/tests/series' })] },
    ];

    const kept = filterNavBy(withLink, (item) => item.to === '/tests/series');

    assert.deepEqual(
      kept.map((item) => item.to),
      ['/tests'],
    );
  });

  it('hides nothing when the rule hides nothing', () => {
    assert.deepEqual(
      filterNavBy(NAV, () => false),
      NAV,
    );
  });
});
