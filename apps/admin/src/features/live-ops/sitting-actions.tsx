import { useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Ban, Clock, RotateCcw, Send } from 'lucide-react';
import { EXTEND_MINUTES_MAX, supportReasonSchema } from '@iace/contracts';
import { applyFieldErrors, numberOr } from '@iace/app-kit';
import {
  Checkbox,
  ConfirmDialog,
  DropdownMenuItem,
  DropdownMenuSeparator,
  FormField,
  Input,
  NumericInput,
  RowActions,
  toast,
} from '@iace/ui';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';

/** Enough of a sitting to act on it. Both panels hand over the same five facts. */
export interface ActionableSitting {
  attemptId: string;
  studentName: string | null;
  mobile: string;
  isGraded: boolean;
  /** Still in progress. Only a live sitting can be submitted, extended or reset. */
  isLive: boolean;
}

const ACTIONS = {
  FORCE_SUBMIT: 'FORCE_SUBMIT',
  EXTEND: 'EXTEND',
  RESET: 'RESET',
  VOID: 'VOID',
} as const;

export type SittingAction = (typeof ACTIONS)[keyof typeof ACTIONS];

/** What a row's menu hands back: the sitting clicked, and what was asked of it. */
export type AskSittingAction = (sitting: ActionableSitting, action: SittingAction) => void;

/** The consequence, named. Every one of these reaches into a sitting somebody is really having. */
const PROMPTS: Readonly<
  Record<
    SittingAction,
    {
      title: (who: string) => string;
      description: string;
      confirmLabel: string;
      destructive: boolean;
    }
  >
> = {
  [ACTIONS.FORCE_SUBMIT]: {
    title: (who) => `Submit the sitting of ${who}?`,
    description:
      'The paper is submitted and marked exactly as it would be if the student had ended it. A ranked sitting stays ranked. Nothing further can be answered.',
    confirmLabel: 'Submit it',
    destructive: false,
  },
  [ACTIONS.EXTEND]: {
    title: (who) => `Add time for ${who}?`,
    description:
      'The deadline moves for this one student, and their clock follows it. Nobody else on the paper is affected.',
    confirmLabel: 'Add the time',
    destructive: false,
  },
  [ACTIONS.RESET]: {
    title: (who) => `Put the live sitting of ${who} back?`,
    description:
      'The answers already saved are read back from the database and the sitting carries on from there. Section timers keep what they have left, and start again from where the paper says only if the live state is gone.',
    confirmLabel: 'Put it back',
    destructive: false,
  },
  [ACTIONS.VOID]: {
    title: (who) => `Void the sitting of ${who}?`,
    description:
      'It is archived rather than deleted, and stops counting: this test loses it from its rank, percentile and averages, and so does the student’s own record. The recount takes about a minute.',
    confirmLabel: 'Void it',
    destructive: true,
  },
};

const SUCCESS: Readonly<Record<SittingAction, string>> = {
  [ACTIONS.FORCE_SUBMIT]: 'Sitting submitted.',
  [ACTIONS.EXTEND]: 'Time added.',
  [ACTIONS.RESET]: 'Live sitting put back.',
  [ACTIONS.VOID]: 'Sitting voided.',
};

const DEFAULT_MINUTES = 15;

const OUT_OF_RANGE = `Between 1 and ${EXTEND_MINUTES_MAX} minutes`;

/** The reason rides every action; the other two fields belong to one action each. */
const actionSchema = z.object({
  reason: supportReasonSchema,
  // A control holds a string, so the range is checked here and the number is read at the call.
  minutes: z.string().refine((raw) => {
    const minutes = numberOr(raw, 0);
    return Number.isInteger(minutes) && minutes >= 1 && minutes <= EXTEND_MINUTES_MAX;
  }, OUT_OF_RANGE),
  regrantRanked: z.boolean(),
});

type ActionValues = z.infer<typeof actionSchema>;

const FIELDS = ['reason', 'minutes', 'regrantRanked'] as const;

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

/** One form and one mutation for a whole panel: a hundred rows each holding their own re-render on every poll. */
export function useSittingActions(): { ask: AskSittingAction; dialog: React.ReactNode } {
  const [asked, setAsked] = useState<{ sitting: ActionableSitting; action: SittingAction } | null>(
    null,
  );
  const queryClient = useQueryClient();

  const form = useForm<ActionValues>({
    resolver: zodResolver(actionSchema),
    defaultValues: { reason: '', minutes: String(DEFAULT_MINUTES), regrantRanked: false },
  });

  const resolve = useMutation({
    meta: { success: SUCCESS[asked?.action ?? ACTIONS.VOID], fields: FIELDS },
    mutationFn: (values: ActionValues) =>
      call(asked?.action ?? null, asked?.sitting.attemptId ?? '', values),
    onSuccess: async (resolved) => {
      if (resolved.rankedRegranted)
        toast.info('The ranked attempt is back for their next sitting.');
      close();
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.LIVE_OPS_BOARD });
    },
    onError: (error) => applyFieldErrors(error, form.setError, FIELDS),
  });

  // The dialog only opens from nothing, so clearing on the way out is what leaves it clean for the next row.
  const close = () => {
    setAsked(null);
    form.reset();
    resolve.reset();
  };

  const ask = useCallback<AskSittingAction>((sitting, action) => setAsked({ sitting, action }), []);

  const prompt = asked ? PROMPTS[asked.action] : null;

  return {
    ask,
    dialog:
      prompt && asked ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && close()}
          loading={resolve.isPending}
          title={prompt.title(whose(asked.sitting))}
          description={prompt.description}
          confirmLabel={prompt.confirmLabel}
          destructive={prompt.destructive}
          onConfirm={form.handleSubmit((values) => resolve.mutate(values))}
        >
          <div className="flex flex-col gap-4">
            {asked.action === ACTIONS.EXTEND ? (
              <FormField form={form} name="minutes" label="Extra time (minutes)">
                {(control) => <NumericInput {...control} className="w-32 tabular-nums" />}
              </FormField>
            ) : null}

            <FormField form={form} name="reason" label="Reason">
              {(control) => <Input {...control} placeholder="What happened" />}
            </FormField>

            {asked.action === ACTIONS.VOID && asked.sitting.isGraded ? (
              <Checkbox
                label="Give the ranked attempt back"
                // ui-copy-ok: consequence — without it the slot stays spent and a re-sit is a retake.
                hint="Their next sitting on this test is ranked again"
                {...form.register('regrantRanked')}
              />
            ) : null}
          </div>
        </ConfirmDialog>
      ) : null,
  };
}

/** The mobile rides the name: a hall can hold two students called the same, and the rows re-sort under the pointer. */
function whose({ studentName, mobile }: ActionableSitting): string {
  return studentName ? `${studentName} (${mobile})` : mobile;
}

function call(action: SittingAction | null, attemptId: string, values: ActionValues) {
  const { reason, minutes, regrantRanked } = values;
  switch (action) {
    case ACTIONS.FORCE_SUBMIT:
      return api.admin.liveOps.forceSubmit(attemptId, { reason });
    case ACTIONS.EXTEND:
      return api.admin.liveOps.extend(attemptId, {
        reason,
        minutes: numberOr(minutes, DEFAULT_MINUTES),
      });
    case ACTIONS.RESET:
      return api.admin.liveOps.reset(attemptId, { reason });
    default:
      return api.admin.liveOps.void(attemptId, { reason, regrantRanked });
  }
}
