import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { BaseConfigDetail, TestDetail } from '@iace/contracts';
import { Alert, Badge, Skeleton, TruncatedText } from '@iace/ui';
import { api } from '../lib/api';
import { QUERY_KEYS, ROUTES } from '../lib/constants';
import { hasPaper, sectionFullness, sectionTally } from './test-paper-view';

/** Amber only where work has started and stalled: an untouched section is not a warning. */
const CHIP_VARIANT = {
  EMPTY: 'neutral',
  SHORT: 'warning',
  FULL: 'success',
} as const;

/** The step is a way in, not the workbench: the paper is built on its own screen. */
export function PaperStep({
  detail,
  config,
}: Readonly<{ detail: TestDetail | null; config: BaseConfigDetail | null }>) {
  const paperExists = detail ? hasPaper(detail) : false;

  const paper = useQuery({
    queryKey: [...QUERY_KEYS.TEST_PAPER, detail?.id ?? '', 0],
    queryFn: () => api.admin.tests.readPaper(detail?.id ?? ''),
    enabled: Boolean(detail?.id) && paperExists,
  });

  if (!detail || !config) {
    return <Alert variant="info">Save this test to build its paper.</Alert>;
  }

  const sections = config.sections;
  if (sections.length === 0) {
    return (
      <Alert variant="warning">
        This test&rsquo;s configuration has no sections, so there is no paper to build.
      </Alert>
    );
  }

  const held = paperExists && paper.data ? tallyOf(paper.data) : null;

  return (
    <div className="flex flex-col gap-3">
      {paperExists ? null : (
        <Alert variant="info">
          This test draws a paper for each student when it is offered, so there are none on it yet.
          What each section draws from is set on the paper screen.
        </Alert>
      )}

      {paper.isLoading ? <Skeleton variant="title" /> : null}

      <ul className="flex flex-col gap-2">
        {sections.map((section) => {
          const fullness = sectionFullness(section, held);
          const tally = sectionTally(section, held);

          return (
            <li key={section.id}>
              <Link
                to={`${ROUTES.TEST_PAPER(detail.id)}?section=${encodeURIComponent(section.id)}`}
                className="flex items-center gap-3 rounded-md border border-border px-4 py-3 transition-colors hover:bg-muted focus-visible:shadow-focus focus-visible:outline-none"
              >
                <TruncatedText className="min-w-0 flex-1 font-medium">{section.name}</TruncatedText>
                {fullness && tally ? (
                  <Badge variant={CHIP_VARIANT[fullness]}>{tally}</Badge>
                ) : (
                  <Badge variant="neutral">{`${section.questionCount} questions`}</Badge>
                )}
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function tallyOf(paper: {
  sections: readonly { baseConfigSectionId: string; questions: readonly unknown[] }[];
}) {
  const counts = new Map<string, number>();
  for (const section of paper.sections) {
    counts.set(section.baseConfigSectionId, section.questions.length);
  }
  return counts;
}
