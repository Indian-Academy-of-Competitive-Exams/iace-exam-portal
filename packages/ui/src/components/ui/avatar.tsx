import * as React from 'react';
import { cn } from '../../lib/utils';

/**
 * A person, at a glance.
 *
 * Falls back to initials rather than a generic silhouette: every student
 * without a photo would otherwise look like every other one, which is worse
 * than useless in a list. Initials come from the name when there is one, and
 * from the mobile number when there is not — a student added by an admin has a
 * number long before anybody types their name.
 */
export interface AvatarProps {
  /** A signed URL. Null while there is no photo on file. */
  src?: string | null;
  name?: string | null;
  /** Used for initials when there is no name yet. */
  fallback?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = {
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-20 text-xl',
} as const;

export function Avatar({ src, name, fallback, size = 'md', className }: Readonly<AvatarProps>) {
  // A signed URL expires. When it does the image 404s, and a broken-image icon
  // is worse than the initials it replaced — so a failed load falls back.
  const [failed, setFailed] = React.useState(false);
  const showPhoto = Boolean(src) && !failed;

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full',
        'bg-primary/[0.14] font-semibold text-primary',
        SIZES[size],
        className,
      )}
      // The name is already beside it in every current use, so announcing it
      // twice would just be noise.
      aria-hidden={!showPhoto}
    >
      {showPhoto ? (
        <img
          src={src ?? undefined}
          alt={name ?? 'Profile photo'}
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        initialsOf(name, fallback)
      )}
    </span>
  );
}

/**
 * Up to two initials.
 *
 * Takes the first letter of the first and last words, so "Kandukuri Venkata
 * Ramana Murthy" reads as KM rather than KV — the last name is the one people
 * are called by.
 */
export function initialsOf(name?: string | null, fallback?: string | null): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    // A mobile number: its last two digits tell two students apart better than
    // its first two, which are usually the same operator prefix.
    const digits = (fallback ?? '').replace(/\D/g, '');
    return digits.slice(-2) || '—';
  }

  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}
