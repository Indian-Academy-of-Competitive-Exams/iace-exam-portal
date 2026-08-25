import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dices } from 'lucide-react';
import {
  AppException,
  ErrorCodes,
  PAPER_BINDING,
  type BaseConfigSection,
  type TestDetail,
} from '@iace/contracts';
import { Alert, Badge, Button, Field, SkeletonParagraph, StatRow } from '@iace/ui';
import { api } from '../lib/api';
import { QuestionMultiPicker } from '../components/question-picker';

/** What the paper holds: the count each section owes, the hand-picks, and the draw. */

const PAPER_KEY = (testId: string) => ['admin', 'test-paper', testId] as const;

/** A draw that could not fill a section answers with one message per section id. */
function shortfallsOf(error: unknown): string[] {
  if (!AppException.is(error) || error.code !== ErrorCodes.DRAW_SHORTFALL) return [];
  return Object.values(error.fieldErrors ?? {}).flat();
}

export function PaperStep({ detail }: Readonly<{ detail: TestDetail }>) {
  const queryClient = useQueryClient();
  const [manual, setManual] = useState<Record<string, string[]>>({});
  const generated = detail.paperBinding === PAPER_BINDING.GENERATED;

  const paper = useQuery({
    queryKey: PAPER_KEY(detail.id),
    queryFn: () => api.admin.tests.readPaper(detail.id),
    enabled: !generated,
  });

  const draw = useMutation({
    meta: { success: 'Paper drawn.' },
    mutationFn: () =>
      api.admin.tests.assemblePaper(detail.id, {
        manual: Object.entries(manual)
          .filter(([, questionIds]) => questionIds.length > 0)
          .map(([baseConfigSectionId, questionIds]) => ({ baseConfigSectionId, questionIds })),
      }),
    onSuccess: async (next) => {
      queryClient.setQueryData(PAPER_KEY(detail.id), next);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'test', detail.id] });
    },
  });

  const held = useMemo(() => {
    const counts = new Map<string, number>();
    for (const section of paper.data?.sections ?? []) {
      counts.set(section.baseConfigSectionId, section.questions.length);
    }
    return counts;
  }, [paper.data]);

  if (generated) {
    return (
      <Alert variant="info">
        This test draws a fresh paper for each student when their attempt starts, so there is no one
        paper to build here. Switch it back to a fixed paper on Rules if every student should sit
        the same questions.
      </Alert>
    );
  }

  const gaps = shortfallsOf(draw.error);
  const drawn = [...held.values()].reduce((sum, count) => sum + count, 0);

  return (
    <div className="flex flex-col gap-4">
      <StatRow label="Drawn" value={`${drawn} of ${detail.totalQuestions}`} />

      {gaps.length > 0 ? (
        <Alert variant="warning">
          <span className="flex flex-col gap-1">
            <span>The bank cannot fill this paper yet, so nothing was drawn.</span>
            {gaps.map((gap) => (
              <span key={gap}>{gap}</span>
            ))}
          </span>
        </Alert>
      ) : null}

      {detail.isLocked ? (
        <Alert variant="info">
          This paper is frozen. Every student sits exactly these questions, in this order.
        </Alert>
      ) : null}

      {paper.isLoading ? <SkeletonParagraph lines={detail.baseConfig.sections.length} /> : null}

      <div className="flex flex-col gap-4">
        {paper.isLoading
          ? null
          : detail.baseConfig.sections.map((section) => (
              <SectionRow
                key={section.id}
                section={section}
                held={held.get(section.id) ?? 0}
                pinned={manual[section.id] ?? []}
                frozen={detail.isLocked}
                onPin={(next) => setManual((held) => ({ ...held, [section.id]: next }))}
              />
            ))}
      </div>

      {drawn > 0 && !detail.isLocked ? (
        <Alert variant="info">
          Drawing again replaces every question below, keeping only what you have chosen by hand.
        </Alert>
      ) : null}

      {detail.isLocked ? null : (
        <Button type="button" onClick={() => draw.mutate()} loading={draw.isPending}>
          <Dices aria-hidden />
          {drawn > 0 ? 'Draw again' : 'Draw the paper'}
        </Button>
      )}
    </div>
  );
}

function SectionRow({
  section,
  held,
  pinned,
  frozen,
  onPin,
}: Readonly<{
  section: BaseConfigSection;
  held: number;
  pinned: readonly string[];
  frozen: boolean;
  onPin: (next: string[]) => void;
}>) {
  const short = held < section.questionCount;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <StatRow
        label={section.name}
        value={
          <span className="inline-flex items-center gap-2">
            <span>{`${held} of ${section.questionCount}`}</span>
            {short ? <Badge variant="warning">Short</Badge> : <Badge variant="success">Full</Badge>}
          </span>
        }
      />
      <Field htmlFor={`pin-${section.id}`} label="Choose by hand" hint="The draw fills the rest">
        {(control) => (
          <QuestionMultiPicker
            {...control}
            subjectId={section.subjectId}
            value={pinned}
            disabled={frozen}
            onChange={onPin}
          />
        )}
      </Field>
    </div>
  );
}
