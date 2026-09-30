import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

/** Same prompt wherever a question is deleted, so every one of those confirms reads alike. */
const DELETE_PROMPT = { title: 'Delete this question?', confirmLabel: 'Delete' } as const;

/** Deleting one question: its confirm and its call, wherever the trigger sits — a card's button or a row's menu. */
export function useDeleteQuestion({
  consequence,
  remove,
  onDeleted,
}: Readonly<{
  /** What the delete costs, naming the question the way its own screen names it. */
  consequence: string;
  remove: () => Promise<unknown>;
  onDeleted: () => Promise<unknown> | void;
}>) {
  const [asking, setAsking] = useState(false);

  const deleting = useMutation({
    meta: { success: 'Question deleted.' },
    mutationFn: remove,
    onSuccess: async () => {
      await onDeleted();
      setAsking(false);
    },
    // Drop out of the confirm on failure, or it keeps asking a question already answered.
    onError: () => setAsking(false),
  });

  return {
    ask: () => setAsking(true),
    /** Spread onto the screen's own `ConfirmDialog`, which stays beside the call it guards. */
    confirm: {
      open: asking,
      onOpenChange: setAsking,
      title: DELETE_PROMPT.title,
      description: consequence,
      confirmLabel: DELETE_PROMPT.confirmLabel,
      destructive: true,
      loading: deleting.isPending,
      onConfirm: () => deleting.mutate(),
    },
  };
}
