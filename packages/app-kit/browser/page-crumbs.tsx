import { useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Breadcrumbs, type BreadcrumbItem } from '@iace/ui';
import { activeNavPath, collapseLoneSections, navTrail, type NavItem } from '../src';
import { recallNavUrl, rememberNavUrl } from './nav-memory';

/** The trail, read off the nav. `tail` carries what the nav cannot know: the record shown. */
export function PageCrumbs({
  nav,
  tail = [],
}: Readonly<{ nav: readonly NavItem[]; tail?: readonly BreadcrumbItem[] }>) {
  const { pathname, search } = useLocation();
  const here = `${pathname}${search}`;
  // The same shape the rail draws, or a section it collapsed still shows as a crumb of its own.
  const shown = useMemo(() => collapseLoneSections(nav), [nav]);
  const active = activeNavPath(shown, pathname);

  // Standing ON a nav route is the only chance to learn how its list was filtered.
  useEffect(() => {
    if (active === pathname) rememberNavUrl(active, here);
  }, [active, pathname, here]);

  const items = [...navTrail(shown, pathname), ...tail].map((crumb) => {
    if (crumb.to === undefined) return crumb;
    const to = recallNavUrl(crumb.to);
    // A crumb pointing where you already are is a link to nothing, whichever crumb it is.
    return to === here ? { label: crumb.label } : { ...crumb, to };
  });

  return (
    <Breadcrumbs
      items={items}
      renderLink={(to, children, className) => (
        <Link to={to} className={className}>
          {children}
        </Link>
      )}
    />
  );
}
