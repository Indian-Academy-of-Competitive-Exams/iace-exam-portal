import { useMutation } from '@tanstack/react-query';
import { type AssignmentWithTest } from '@iace/contracts';
import { ConfirmDialog, plural } from '@iace/ui';
import { api } from '../../lib/api';

/** A reader's "I have read this"; the typist's hand-over is the Done dialog, which chooses the paper. */
export function FinalizeAssignmentDialog({
  assignment,
  covering,
  onClose,
  onFinalized,
}: Readonly<{
  assignment: AssignmentWithTest | null;
  /** What the section actually holds — the section screen knows it; the queue reads the section's count. */
  covering?: number;
  onClose: () => void;
  onFinalized: () => void;
}>) {
  const count = covering ?? assignment?.sectionQuestionCount ?? 0;
  const test = assignment?.testTitle ?? 'this test';

  const finalize = useMutation({
    meta: { success: `${assignment?.sectionName ?? 'Section'} marked read.` },
    mutationFn: (id: string) => api.admin.assignments.finalize(id),
    onSuccess: () => {
      onFinalized();
      onClose();
    },
  });

  return (
    <ConfirmDialog
      open={assignment !== null}
      onOpenChange={(open) => !open && onClose()}
      title={`Mark ${assignment?.sectionName ?? 'this section'} read?`}
      description={`This covers ${plural(count, 'question')} in ${test}. You cannot edit them afterwards, and the test is one section closer to being offered.`}
      confirmLabel="Mark read"
      loading={finalize.isPending}
      onConfirm={() => assignment?.id && finalize.mutate(assignment.id)}
    />
  );
}
