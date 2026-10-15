import { Ban, Clock, RotateCcw, Send } from 'lucide-react';
import { DropdownMenuItem, DropdownMenuSeparator, RowActions } from '@iace/ui';
import { ACTIONS, type ActionableSitting, type AskSittingAction } from './sitting-actions';

/** The row's own menu, and nothing else: the form and the mutation belong to the panel. */
export function SittingActions({
  sitting,
  onAsk,
}: Readonly<{ sitting: ActionableSitting; onAsk: AskSittingAction }>) {
  return (
    <RowActions label={`Act on ${sitting.studentName ?? 'this sitting'}`}>
      {sitting.isLive ? (
        <>
          <DropdownMenuItem onSelect={() => onAsk(sitting, ACTIONS.FORCE_SUBMIT)}>
            <Send aria-hidden />
            Submit now
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAsk(sitting, ACTIONS.EXTEND)}>
            <Clock aria-hidden />
            Add time
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAsk(sitting, ACTIONS.RESET)}>
            <RotateCcw aria-hidden />
            Put the live sitting back
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      ) : null}

      <DropdownMenuItem destructive onSelect={() => onAsk(sitting, ACTIONS.VOID)}>
        <Ban aria-hidden />
        Void
      </DropdownMenuItem>
    </RowActions>
  );
}
