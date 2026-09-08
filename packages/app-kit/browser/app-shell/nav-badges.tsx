import * as React from 'react';

/** Counts a nav row carries, keyed by its route — a number, so `nav.ts` stays DOM-free. */
export type NavBadges = Readonly<Record<string, number>>;

const NavBadgeContext = React.createContext<NavBadges>({});

export function NavBadgeProvider({
  badges,
  children,
}: Readonly<{ badges: NavBadges; children: React.ReactNode }>) {
  return <NavBadgeContext value={badges}>{children}</NavBadgeContext>;
}

/** Zero is no badge: a row announcing "0 unread" is a row saying nothing. */
export function useNavBadge(to: string | undefined): number {
  const badges = React.useContext(NavBadgeContext);
  return to === undefined ? 0 : (badges[to] ?? 0);
}

/** Past this the count stops being a number and becomes "a lot", which is all it has to say. */
const MAX_SHOWN = 9;

export function NavBadge({ count, collapsed }: Readonly<{ count: number; collapsed: boolean }>) {
  if (count <= 0) return null;
  const shown = count > MAX_SHOWN ? `${MAX_SHOWN}+` : String(count);

  return (
    <span
      aria-hidden
      className={
        collapsed
          ? 'absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.625rem] font-medium leading-none text-primary-foreground'
          : 'ms-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.625rem] font-medium leading-none text-primary-foreground'
      }
    >
      {shown}
    </span>
  );
}
