import { Link } from 'react-router-dom';
import { cn, linkVariants } from '@iace/ui';
import { ROUTES } from '../lib/constants';

/** The stem or the code, as the way into the question behind it — its own tab, so the list it came from stays put. */
export function QuestionLink({
  questionId,
  children,
}: Readonly<{ questionId: string; children: React.ReactNode }>) {
  return (
    <Link
      to={ROUTES.QUESTION(questionId)}
      target="_blank"
      rel="noreferrer"
      className={cn(linkVariants(), 'block w-full min-w-0 text-left')}
    >
      {children}
    </Link>
  );
}
