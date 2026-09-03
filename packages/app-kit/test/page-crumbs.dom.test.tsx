import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PageCrumbs } from '../browser/page-crumbs';
import { forgetNavUrls } from '../browser/nav-memory';
import { type NavItem } from '../src';

afterEach(cleanup);
beforeEach(forgetNavUrls);

const NAV: NavItem[] = [
  {
    label: 'Students',
    children: [
      { to: '/students', label: 'All students' },
      { to: '/students/import', label: 'Import students' },
    ],
  },
  { to: '/tests', label: 'Tests' },
];

const at = (url: string, tail: { label: string; to?: string }[] = []) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <PageCrumbs nav={NAV} tail={tail} />
    </MemoryRouter>,
  );

describe('PageCrumbs', () => {
  /** The whole reason navTrail stopped deciding: one nav crumb plus a record is a trail. */
  it('draws a trail once a record joins a single nav crumb', () => {
    at('/tests/tst_1/about', [{ label: 'SSC CGL Mock 1' }]);

    // Twice: the trail's own crumb, and the back link that replaces the trail below `sm`.
    assert.equal(screen.getAllByRole('link', { name: 'Tests' }).length, 2);
    assert.ok(screen.getByText('SSC CGL Mock 1'));
  });

  it('still draws nothing on a top-level screen that adds no record', () => {
    const { container } = at('/tests');

    assert.equal(container.firstChild, null);
  });

  /** A link back to the page you are reading is furniture, wherever it sits in the trail. */
  it('unlinks a crumb that points where you already are', () => {
    at('/students');

    assert.equal(screen.queryByRole('link', { name: 'All students' }), null);
    assert.ok(screen.getByText('All students'));
  });

  it('links the last crumb when it goes somewhere other than here', () => {
    at('/students/stu_1/history', [{ label: 'Asha Kumari', to: '/students/stu_1' }]);

    assert.equal(
      screen.getByRole('link', { name: 'Asha Kumari' }).getAttribute('href'),
      '/students/stu_1',
    );
  });
});

describe('PageCrumbs and a list left filtered', () => {
  /** Filters and the open tab live in the query string: the list you left is not its bare route. */
  it('sends you back to the list as you had it', () => {
    at('/students?branchId=brn_1&match=any');
    cleanup();

    at('/students/stu_1', [{ label: 'Asha Kumari' }]);

    assert.equal(
      screen.getAllByRole('link', { name: 'All students' })[0]?.getAttribute('href'),
      '/students?branchId=brn_1&match=any',
    );
  });

  /** Nothing remembered is the bare route, which is where a deep link has to land. */
  it('falls back to the plain route when the list was never visited', () => {
    at('/students/stu_1', [{ label: 'Asha Kumari' }]);

    assert.equal(
      screen.getAllByRole('link', { name: 'All students' })[0]?.getAttribute('href'),
      '/students',
    );
  });
});
