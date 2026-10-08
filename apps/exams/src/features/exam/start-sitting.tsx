/** The door to a sitting. This click is the gesture full screen needs — an effect cannot ask. */
import { Link } from 'react-router-dom';
import { Button } from '@iace/ui';
import { useFullscreen } from '@iace/app-kit/browser';
import { ROUTES } from '../../lib/constants';
import { resumeSearch } from './use-sitting-address';

export function StartSitting({
  testId,
  resume,
  size,
  className,
  children,
}: Readonly<{
  testId: string;
  resume?: string | null;
  size?: NonNullable<React.ComponentProps<typeof Button>['size']>;
  className?: string;
  children: React.ReactNode;
}>) {
  const fullscreen = useFullscreen();

  return (
    <Button asChild size={size} className={className}>
      <Link
        to={{ pathname: ROUTES.TEST_INSTRUCTIONS(testId), search: resumeSearch(resume) }}
        onClick={() => void fullscreen.enter()}
      >
        {children}
      </Link>
    </Button>
  );
}
