import { useState } from 'react';
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
import { api } from '../lib/api';
import { QUERY_KEYS } from '../lib/constants';

/** Enough of a sitting to act on it. Both panels hand over the same four facts. */
export interface ActionableSitting {
  attemptId: string;
  studentName: string | null;
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

type Action = (typeof ACTIONS)[keyof typeof ACTIONS];

/** The consequence, named. Every one of these reaches into a sitting somebody is really having. */
const PROMPTS: Readonly<
  Record<Action, { title: string; description: string; confirmLabel: string; destructive: boolean }>
> = {
  [ACTIONS.FORCE_SUBMIT]: {
    title: 'Submit this sitting?',
    description:
      'The paper is submitted and marked exactly as it would be if the student had ended it. A ranked sitting stays ranked. Nothing further can be answered.',
    confirmLabel: 'Submit it',
    destructive: false,
  },
  [ACTIONS.EXTEND]: {
    title: 'Add time to this sitting?',
    description:
      'The deadline moves for this one student, and their clock follows it. Nobody else on the paper is affected.',
    confirmLabel: 'Add the time',
    destructive: false,
  },
  [ACTIONS.RESET]: {
    title: 'Put this live sitting back?',
    description:
      'The answers already saved are read back from the database and the sitting carries on from there. Section timers start again from where the paper says.',
    confirmLabel: 'Put it back',
    destructive: false,
  },
  [ACTIONS.VOID]: {
    title: 'Void this sitting?',
    description:
      'It is archived rather than deleted, and stops counting: this test loses it from its rank, percentile and averages, and so does the student’s own record. The recount takes about a minute.',
    confirmLabel: 'Void it',
    destructive: true,
  },
};

const SUCCESS: Readonly<Record<Action, string>> = {
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

export function SittingActions({ sitting }: Readonly<{ sitting: ActionableSitting }>) {
  const [asking, setAsking] = useState<Action | null>(null);
  const queryClient = useQueryClient();

  const form = useForm<ActionValues>({
    resolver: zodResolver(actionSchema),
    defaultValues: { reason: '', minutes: String(DEFAULT_MINUTES), regrantRanked: false },
  });

  const resolve = useMutation({
    meta: { success: SUCCESS[asking ?? ACTIONS.VOID], fields: FIELDS },
    mutationFn: (values: ActionValues) => call(asking, sitting.attemptId, values),
    onSuccess: async (resolved) => {
      if (resolved.rankedRegranted)
        toast.info('The ranked attempt is back for their next sitting.');
      close();
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.LIVE_OPS });
    },
    onError: (error) => applyFieldErrors(error, form.setError, FIELDS),
  });

  const close = () => {
    setAsking(null);
    form.reset();
  };

  const ask = (action: Action) => {
    resolve.reset();
    form.reset();
    setAsking(action);
  };

  const prompt = asking ? PROMPTS[asking] : null;

  return (
    <>
      <RowActions label={`Act on ${sitting.studentName ?? 'this sitting'}`}>
        {sitting.isLive ? (
          <>
            <DropdownMenuItem onSelect={() => ask(ACTIONS.FORCE_SUBMIT)}>
              <Send aria-hidden />
              Submit now
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => ask(ACTIONS.EXTEND)}>
              <Clock aria-hidden />
              Add time
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => ask(ACTIONS.RESET)}>
              <RotateCcw aria-hidden />
              Put the live sitting back
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}

        <DropdownMenuItem destructive onSelect={() => ask(ACTIONS.VOID)}>
          <Ban aria-hidden />
          Void
        </DropdownMenuItem>
      </RowActions>

      {prompt && asking ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && close()}
          loading={resolve.isPending}
          title={prompt.title}
          description={prompt.description}
          confirmLabel={prompt.confirmLabel}
          destructive={prompt.destructive}
          onConfirm={form.handleSubmit((values) => resolve.mutate(values))}
        >
          <div className="flex flex-col gap-4">
            {asking === ACTIONS.EXTEND ? (
              <FormField form={form} name="minutes" label="Extra time (minutes)">
                {(control) => <NumericInput {...control} className="w-32 tabular-nums" />}
              </FormField>
            ) : null}

            <FormField form={form} name="reason" label="Reason">
              {(control) => <Input {...control} placeholder="What happened" />}
            </FormField>

            {asking === ACTIONS.VOID && sitting.isGraded ? (
              <Checkbox
                label="Give the ranked attempt back"
                // ui-copy-ok: consequence — without it the slot stays spent and a re-sit is a retake.
                hint="Their next sitting on this test is ranked again"
                {...form.register('regrantRanked')}
              />
            ) : null}
          </div>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

function call(action: Action | null, attemptId: string, values: ActionValues) {
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
