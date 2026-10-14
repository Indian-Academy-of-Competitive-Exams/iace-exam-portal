/** The door to a sitting. This click is the gesture full screen needs — an effect cannot ask. */
import { Link } from 'react-router-dom';
import { Play, RotateCcw } from 'lucide-react';
import { Button } from '@iace/ui';
import { useFullscreen } from '@iace/app-kit/browser';
import { ROUTES } from '../../lib/constants';
import { resumeSearch } from './use-sitting-address';

export function StartSitting({
  testId,
  resume,
  size,
  variant,
  className,
  children,
}: Readonly<{
  testId: string;
  resume?: string | null;
  size?: NonNullable<React.ComponentProps<typeof Button>['size']>;
  variant?: NonNullable<React.ComponentProps<typeof Button>['variant']>;
  className?: string;
  children: React.ReactNode;
}>) {
  const fullscreen = useFullscreen();
  const Glyph = resume ? RotateCcw : Play;

  return (
    <Button asChild size={size} variant={variant} className={className}>
      <Link
        to={{ pathname: ROUTES.TEST_INSTRUCTIONS(testId), search: resumeSearch(resume) }}
        onClick={() => void fullscreen.enter()}
      >
        <Glyph aria-hidden />
        {children}
      </Link>
    </Button>
  );
}
