import type { AnswerState } from '@iace/contracts';
import { cn } from '@iace/ui';
import { STATE_CLASS } from './states';

export function StateSwatch({ state, count }: Readonly<{ state: AnswerState; count: number }>) {
  return <span className={cn('rw-cell rw-swatch', STATE_CLASS[state])}>{count}</span>;
}
