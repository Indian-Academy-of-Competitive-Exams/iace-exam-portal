/** The door to a sitting. This click is the gesture full screen needs — an effect cannot ask. */
import { Link } from 'react-router-dom';
import { Button } from '@iace/ui';
import { useFullscreen } from '@iace/app-kit/browser';
import { ROUTES } from '../../lib/constants';

export function StartSitting({
  testId,
  size,
  className,
  children,
}: Readonly<{
  testId: string;
  size?: React.ComponentProps<typeof Button>['size'];
  className?: string;
  children: React.ReactNode;
}>) {
  const fullscreen = useFullscreen();

  return (
    <Button asChild size={size} className={className}>
      <Link to={ROUTES.TEST_INSTRUCTIONS(testId)} onClick={() => void fullscreen.enter()}>
        {children}
      </Link>
    </Button>
  );
}
