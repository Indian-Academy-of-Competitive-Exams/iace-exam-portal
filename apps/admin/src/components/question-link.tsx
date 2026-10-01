import { Link } from 'react-router-dom';
import { FEATURE_KEYS, PERMISSION_LEVELS } from '@iace/contracts';
import { cn, linkVariants } from '@iace/ui';
import { ROUTES } from '../lib/constants';
import { useAuth } from '../providers/auth';

const STEM_BOX = 'block w-full min-w-0 text-left';

/** The stem or the code, as the way into the question behind it — its own tab, so the list it came from stays put. */
export function QuestionLink({
  questionId,
  children,
}: Readonly<{ questionId: string; children: React.ReactNode }>) {
  const { can } = useAuth();

  // A test owner reads the picker and the paper but not the bank, so for them the stem is text.
  if (!can(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.READ)) {
    return <span className={STEM_BOX}>{children}</span>;
  }

  return (
    <Link
      to={ROUTES.QUESTION(questionId)}
      target="_blank"
      rel="noreferrer"
      className={cn(linkVariants(), STEM_BOX)}
    >
      {children}
    </Link>
  );
}
