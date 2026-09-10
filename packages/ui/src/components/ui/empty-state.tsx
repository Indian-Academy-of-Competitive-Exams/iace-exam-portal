import * as React from 'react';
import { CircleX, Inbox, Lock, SearchX, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './button';

/** The four absences a region can have. The glyph says which one before a word is read. */
export const EMPTY_STATE_KINDS = {
  EMPTY: 'EMPTY',
  FILTERED: 'FILTERED',
  FAILURE: 'FAILURE',
  REFUSED: 'REFUSED',
} as const;

export type EmptyStateKind = (typeof EMPTY_STATE_KINDS)[keyof typeof EMPTY_STATE_KINDS];

const KIND_ICON: Readonly<Record<EmptyStateKind, LucideIcon>> = {
  EMPTY: Inbox,
  FILTERED: SearchX,
  FAILURE: CircleX,
  REFUSED: Lock,
};

/** The two that are not "nothing yet" carry a tone, mirrored by `.empty--error`/`--refused`. */
const NEUTRAL_DISC = 'bg-[var(--empty-icon-bg)] text-[var(--empty-icon)]';
const KIND_DISC: Readonly<Record<EmptyStateKind, string>> = {
  EMPTY: NEUTRAL_DISC,
  FILTERED: NEUTRAL_DISC,
  FAILURE: 'bg-destructive/10 text-destructive',
  REFUSED: 'bg-warning/15 text-warning-ink',
};

const SIZES = {
  md: { root: 'gap-3 p-[var(--empty-pad)]', disc: 'size-12', glyph: 'size-6', title: 'text-md' },
  sm: { root: 'gap-2', disc: 'size-9', glyph: 'size-5', title: 'text-sm' },
} as const;

export type EmptyStateSize = keyof typeof SIZES;

const HEADING_TAG = { 2: 'h2', 3: 'h3' } as const;

/** What a region shows in place of content. A bare string is its title and nothing else. */
export interface EmptyCopy {
  /** The plain noun for what is absent — "No tests yet". Never a sentence about the reader. */
  title: string;
  /** A rule or consequence they cannot read off the screen; never advice for a button they can see. */
  hint?: string;
  /** The one action that resolves it — Retry on a failure, a way onward from a refusal. */
  action?: React.ReactNode;
  /** Only where the kind's own glyph would misstate the absence. */
  icon?: LucideIcon;
}

export type EmptyMessage = string | EmptyCopy;

export const emptyCopy = (message: EmptyMessage): EmptyCopy =>
  typeof message === 'string' ? { title: message } : message;

export interface EmptyStateProps extends EmptyCopy {
  kind?: EmptyStateKind;
  /** Draws the Retry when there is no `action` — a failure without one is a dead end. */
  onRetry?: () => void;
  /** `sm` for a table body or a panel, where the region is already padded. */
  size?: EmptyStateSize;
  /** Set to 3 when nested under a `SectionHeading` — never two `h2`s in one region. */
  level?: 2 | 3;
  className?: string;
}

export function EmptyState({
  kind = EMPTY_STATE_KINDS.EMPTY,
  size = 'md',
  icon,
  title,
  hint,
  action,
  onRetry,
  level = 2,
  className,
}: Readonly<EmptyStateProps>) {
  const Tag = HEADING_TAG[level];
  const Icon = icon ?? KIND_ICON[kind];
  const sizing = SIZES[size];
  const retry = onRetry ? (
    <Button variant="outline" size="sm" onClick={onRetry}>
      Retry
    </Button>
  ) : null;

  return (
    <div
      className={cn(
        'mx-auto flex max-w-[var(--empty-max-w)] flex-col items-center text-center',
        sizing.root,
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex items-center justify-center rounded-full',
          sizing.disc,
          KIND_DISC[kind],
        )}
      >
        <Icon className={sizing.glyph} />
      </span>
      <Tag className={cn('font-semibold text-foreground', sizing.title)}>{title}</Tag>
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      {action ?? retry}
    </div>
  );
}
