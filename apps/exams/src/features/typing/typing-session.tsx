/** One practice session, full screen like the sitting it rehearses: fetch a passage, type, see the result. */
import { useRef, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AppException,
  EXAM_TEMPLATE,
  ErrorCodes,
  TYPING_PRESETS,
  scoreTyping,
  typablePassage,
  typingPresetKeySchema,
  type ExamClock,
  type TypingPreset,
  type TypingPresetKey,
  type TypingResult,
} from '@iace/contracts';
import { Button, ConfirmDialog, EMPTY_STATE_KINDS, EmptyState, LoadingState } from '@iace/ui';
import { api } from '../../lib/api';
import { ROUTES, typingPassageQueryKey, typingPracticesQueryKey } from '../../lib/constants';
import { ExamTimer } from '../exam/exam-timer';
import { TypingPane } from './typing-pane';
import { TypingResultView } from './typing-result';

const MILLISECONDS_PER_SECOND = 1000;

export function TypingSessionPage() {
  const { presetKey = '' } = useParams();
  const parsed = typingPresetKeySchema.safeParse(presetKey);
  if (!parsed.success) return <Navigate to={ROUTES.TYPING} replace />;
  return <Session key={parsed.data} presetKey={parsed.data} />;
}

function Session({ presetKey }: Readonly<{ presetKey: TypingPresetKey }>) {
  const preset = TYPING_PRESETS[presetKey];
  const queryClient = useQueryClient();
  const [result, setResult] = useState<TypingResult | null>(null);
  const typedRef = useRef('');

  // Never refetched behind their back: a new passage mid-session would be a different test.
  const passage = useQuery({
    queryKey: typingPassageQueryKey(presetKey),
    queryFn: () => api.me.typingPassage(presetKey),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const save = useMutation({
    mutationFn: (typed: string) =>
      api.me.finishTypingPractice({ presetKey, questionId: passage.data?.questionId ?? '', typed }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: typingPracticesQueryKey() }),
  });

  if (passage.isPending || passage.isFetching) {
    return <LoadingState>Fetching a passage</LoadingState>;
  }
  if (passage.isError) {
    const none = AppException.is(passage.error) && passage.error.code === ErrorCodes.NOT_FOUND;
    return none ? (
      <EmptyState title="No passages yet" />
    ) : (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Could not fetch a passage"
        onRetry={() => void passage.refetch()}
      />
    );
  }

  const text = passage.data.text;
  if (result) {
    return (
      <TypingResultView
        preset={preset}
        result={result}
        saveFailed={save.isError}
        saving={save.isPending}
        onSaveAgain={() => save.mutate(typedRef.current)}
        onTypeAnother={() => {
          setResult(null);
          save.reset();
          void passage.refetch();
        }}
      />
    );
  }

  return (
    <Sitting
      preset={preset}
      passage={text}
      onFinish={(typed) => {
        typedRef.current = typed;
        setResult(scoreTyping(text, typed, preset));
        save.mutate(typed);
      }}
    />
  );
}

function Sitting({
  preset,
  passage,
  onFinish,
}: Readonly<{ preset: TypingPreset; passage: string; onFinish: (typed: string) => void }>) {
  const [typed, setTyped] = useState('');
  const [confirming, setConfirming] = useState(false);
  // The countdown calls whichever of these the latest render made, so it sees all that was typed.
  const finish = () => onFinish(typed);

  // Nothing is ranked here, so the device's own clock is the only clock there is.
  const [clock] = useState<ExamClock>(() => {
    const now = Date.now();
    return {
      serverNow: new Date(now).toISOString(),
      endsAt: new Date(now + preset.durationSec * MILLISECONDS_PER_SECOND).toISOString(),
      arrivedAt: now,
    };
  });

  return (
    <div
      data-exam-template={EXAM_TEMPLATE.DEFAULT.toLowerCase()}
      className="flex h-dvh flex-col bg-exam-surface text-exam-ink"
    >
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-exam-border px-exam py-2">
        <h1 className="min-w-0 truncate text-base font-semibold">{preset.label}</h1>
        <ExamTimer clock={clock} onExpire={finish} />
      </header>

      <TypingPane
        passage={passage}
        value={typed}
        onChange={setTyped}
        backspace={preset.backspace}
      />

      <footer className="flex shrink-0 justify-end border-t border-exam-border px-exam py-2">
        <Button onClick={() => setConfirming(true)}>Submit</Button>
      </footer>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Submit typing"
        description={`The test ends now, with ${typablePassage(typed).length.toLocaleString('en-IN')} key depressions typed.`}
        confirmLabel="Submit"
        onConfirm={finish}
      />
    </div>
  );
}
