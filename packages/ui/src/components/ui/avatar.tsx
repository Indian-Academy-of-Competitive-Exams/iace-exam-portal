import * as React from 'react';
import { cn } from '../../lib/utils';

/** A photo, or initials from the name, or from the mobile number. */
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
  // Signed URLs expire; a failed load falls back to initials.
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
      // The name is already beside it in every current use.
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

/** First letter of the first and last word: "Kandukuri Venkata Ramana Murthy" is KM. */
export function initialsOf(name?: string | null, fallback?: string | null): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    // A mobile number: the first two digits are the operator prefix, so take the last two.
    const digits = (fallback ?? '').replace(/\D/g, '');
    return digits.slice(-2) || '—';
  }

  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}
