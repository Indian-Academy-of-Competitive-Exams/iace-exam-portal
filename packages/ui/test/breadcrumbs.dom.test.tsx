import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { cleanup, render, screen } from '@testing-library/react';
import { Breadcrumbs, type BreadcrumbItem } from '../src/components/ui/breadcrumbs';

afterEach(cleanup);

const link = (to: string, children: React.ReactNode, className: string) => (
  <a href={to} className={className}>
    {children}
  </a>
);

const TRAIL: BreadcrumbItem[] = [
  { label: 'Students' },
  { label: 'All students', to: '/students' },
  { label: 'Asha Kumari' },
];

describe('Breadcrumbs', () => {
  /** One crumb is the page you are on, and the title already says that. */
  it('renders nothing for a single crumb', () => {
    const { container } = render(<Breadcrumbs items={[{ label: 'Students' }]} renderLink={link} />);

    assert.equal(container.firstChild, null);
  });

  it('marks the last crumb as the page when it is where you already are', () => {
    render(<Breadcrumbs items={TRAIL} renderLink={link} />);

    const current = screen.getByText('Asha Kumari');
    assert.equal(current.getAttribute('aria-current'), 'page');
    assert.equal(current.tagName, 'SPAN');
  });

  /** A record shown through a tab: the last crumb is the record, which is not this page. */
  it('links the last crumb when it carries a route of its own', () => {
    render(
      <Breadcrumbs
        items={[...TRAIL.slice(0, 2), { label: 'Asha Kumari', to: '/students/stu_1' }]}
        renderLink={link}
      />,
    );

    const current = screen.getByRole('link', { name: 'Asha Kumari' });
    assert.equal(current.getAttribute('href'), '/students/stu_1');
    // It is a different destination, so claiming to BE the current page would be a lie.
    assert.equal(current.getAttribute('aria-current'), null);
  });

  /** A section groups screens without being one, so it is text rather than a link. */
  it('does not link a crumb that has no route', () => {
    render(<Breadcrumbs items={TRAIL} renderLink={link} />);

    assert.equal(screen.getByText('Students').tagName, 'SPAN');
    // Two: the trail's own crumb and the narrow-screen back link both point there.
    for (const anchor of screen.getAllByRole('link', { name: 'All students' })) {
      assert.equal(anchor.getAttribute('href'), '/students');
    }
  });

  /** The nearest ancestor that can be REACHED — not the one above, when that is a section. */
  it('offers the nearest linkable ancestor as the way back', () => {
    render(<Breadcrumbs items={TRAIL} renderLink={link} />);

    const back = screen.getAllByRole('link', { name: 'All students' });
    assert.equal(back.length, 2, 'once in the trail, once as the narrow-screen back link');
  });

  it('is announced as a breadcrumb trail', () => {
    render(<Breadcrumbs items={TRAIL} renderLink={link} />);

    assert.ok(screen.getByRole('navigation', { name: 'Breadcrumb' }));
  });
});
