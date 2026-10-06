import { DUE_STANDINGS, type DueStanding } from '@iace/contracts';
import { Badge, type BadgeProps } from '@iace/ui';

/** Only what needs attention is said: a section finished by its day carries no badge. */
const FLAGGED: Partial<Record<DueStanding, { label: string; variant: BadgeProps['variant'] }>> = {
  [DUE_STANDINGS.OVERDUE]: { label: 'Overdue', variant: 'danger' },
  [DUE_STANDINGS.LATE]: { label: 'Late', variant: 'warning' },
};

/** A section past its due day: still open, or finished after it. */
export function DueStandingBadge({ standing }: Readonly<{ standing: DueStanding | null }>) {
  const flag = standing ? FLAGGED[standing] : undefined;
  if (!flag) return null;
  return (
    <Badge variant={flag.variant} className="shrink-0">
      {flag.label}
    </Badge>
  );
}
