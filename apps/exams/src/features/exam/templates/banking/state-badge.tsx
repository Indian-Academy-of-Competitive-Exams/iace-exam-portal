import type { AnswerState } from '@iace/contracts';
import { cn } from '@iace/ui';
import { STATE_CLASS } from './states';

export function StateBadge({ state, count }: Readonly<{ state: AnswerState; count?: number }>) {
  return <span className={cn('bk-cell bk-badge', STATE_CLASS[state])}>{count}</span>;
}
