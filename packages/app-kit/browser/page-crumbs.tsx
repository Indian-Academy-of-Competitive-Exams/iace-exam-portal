import { Link, useLocation } from 'react-router-dom';
import { Breadcrumbs, type BreadcrumbItem } from '@iace/ui';
import { navTrail, type NavItem } from '../src';

/** The trail, read off the nav. `tail` carries what the nav cannot know: the record shown. */
export function PageCrumbs({
  nav,
  tail = [],
}: Readonly<{ nav: readonly NavItem[]; tail?: readonly BreadcrumbItem[] }>) {
  const { pathname } = useLocation();

  return (
    <Breadcrumbs
      items={[...navTrail(nav, pathname), ...tail]}
      renderLink={(to, children, className) => (
        <Link to={to} className={className}>
          {children}
        </Link>
      )}
    />
  );
}
