import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import {
  FEATURE_KEYS,
  IMPORT_FIX_KINDS,
  PERMISSION_LEVELS,
  canonicalName,
  type ImportFix,
  type QuestionImportPlan,
} from '@iace/contracts';
import { Alert, Button, plural } from '@iace/ui';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/query-keys';
import { useAuth } from '../../providers/auth';
import { SubjectPicker, TopicPicker } from '../../components/taxonomy-picker';

/** One line per reason that holds back rows; a value the bank lacks carries what can be done about it. */
export function ImportCauses({
  plan,
  run,
  onPlan,
}: Readonly<{
  plan: QuestionImportPlan | null;
  /** The run its actions act on; null once there is nothing left to act on. */
  run: string | null;
  onPlan: (judged: QuestionImportPlan) => void;
}>) {
  const causes = plan?.causes ?? [];
  if (causes.length === 0) return null;
  return (
    <Alert variant="warning">
      <ul className="flex flex-col gap-2">
        {causes.map((cause) => (
          <li key={cause.message} className="flex flex-col gap-1.5">
            <span>{`${cause.message} — ${plural(cause.count, 'row')}`}</span>
            {cause.fix && run ? <FixActions fix={cause.fix} run={run} onPlan={onPlan} /> : null}
          </li>
        ))}
      </ul>
    </Alert>
  );
}

/** Read the value as one the bank holds, for this run alone; or, holding the key, add it to the bank. */
function FixActions({
  fix,
  run,
  onPlan,
}: Readonly<{ fix: ImportFix; run: string; onPlan: (judged: QuestionImportPlan) => void }>) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const taxonomy = fix.kind !== IMPORT_FIX_KINDS.DIFFICULTY;
  const name = canonicalName(fix.value);

  const remap = useMutation({
    mutationFn: (to: string) =>
      api.admin.imports.remapQuestionRun(run, {
        kind: fix.kind,
        from: fix.value,
        to,
        subjectId: fix.subjectId ?? null,
      }),
    onSuccess: onPlan,
  });
  const create = useMutation({
    mutationFn: async () => {
      if (fix.kind === IMPORT_FIX_KINDS.SUBJECT) await api.admin.taxonomy.createSubject({ name });
      else await api.admin.taxonomy.createTopic({ subjectId: fix.subjectId ?? '', name });
      return api.admin.imports.rejudgeQuestionRun(run);
    },
    onSuccess: (judged) => {
      for (const queryKey of [QUERY_KEYS.SUBJECTS, QUERY_KEYS.TOPICS]) {
        void queryClient.invalidateQueries({ queryKey });
      }
      onPlan(judged);
    },
  });
  const busy = remap.isPending || create.isPending;
  const choose = (to: string) => {
    if (to) remap.mutate(to);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {fix.suggestions.map((choice) => (
        <Button
          key={choice.value}
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => remap.mutate(choice.value)}
        >
          {`Use ${choice.label}`}
        </Button>
      ))}
      {fix.kind === IMPORT_FIX_KINDS.SUBJECT ? (
        <div className="w-56">
          <SubjectPicker value="" onChange={choose} placeholder="Choose another…" disabled={busy} />
        </div>
      ) : null}
      {fix.kind === IMPORT_FIX_KINDS.TOPIC && fix.subjectId ? (
        <div className="w-56">
          <TopicPicker
            subjectId={fix.subjectId}
            value=""
            onChange={choose}
            placeholder="Choose another…"
            disabled={busy}
          />
        </div>
      ) : null}
      {taxonomy && can(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.WRITE) ? (
        <Button
          type="button"
          size="sm"
          disabled={busy}
          loading={create.isPending}
          onClick={() => create.mutate()}
        >
          <Plus aria-hidden />
          {`Create ${name}`}
        </Button>
      ) : null}
    </div>
  );
}
