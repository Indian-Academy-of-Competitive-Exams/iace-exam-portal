import { useRef } from 'react';
import { useParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import {
  LANGUAGE_LABELS,
  QUESTION_TYPE,
  REPORT_LETTERHEAD,
  contentLanguageOf,
  optionLetter,
  type ExamQuestion,
  type LanguageCode,
  type PrintablePaper,
} from '@iace/contracts';
import { htmlOf, logoUrl } from '@iace/app-kit';
import { PageCrumbs, printElement, useFilterSpec, useFilters } from '@iace/app-kit/browser';
import {
  EMPTY_STATE_KINDS,
  Button,
  Card,
  EmptyState,
  PageFrame,
  PageHeader,
  RichContent,
  Skeleton,
  SkeletonParagraph,
  plural,
  type ListFilter,
} from '@iace/ui';
import { api } from '../../lib/api';
import { NAV_ITEMS, ROUTES, testPaperPrintQueryKey } from '../../lib/constants';
import { durationLabel } from '../../lib/duration';
import { useAuth } from '../../providers/auth';

const UNTITLED = 'Untitled test';
/** A drawing, not `Brandmark`: a printer drops the plate a background would paint. */
const SHEET_LOGO = logoUrl(28);
const WITH_KEY = 'true';

/** What the paper is printed in, and for a super admin whether its key goes with it. */
function paperFilters(available: readonly LanguageCode[], mayPrintKey: boolean): ListFilter[] {
  const languages: ListFilter[] =
    available.length > 1
      ? [
          {
            key: 'languages',
            kind: 'multi',
            label: 'Languages',
            primary: true,
            placeholder: 'Every language',
            items: available.map((language) => ({
              value: language,
              label: LANGUAGE_LABELS[contentLanguageOf(language)],
            })),
          },
        ]
      : [];
  const key: ListFilter[] = mayPrintKey
    ? [
        {
          key: 'answerKey',
          kind: 'choice',
          label: 'Answer key',
          primary: true,
          items: [
            { value: '', label: 'Without answer key' },
            { value: WITH_KEY, label: 'With answer key' },
          ],
        },
      ]
    : [];
  return [...languages, ...key];
}

/** A test's whole paper as a hall is handed it, drawn by the app's own renderer and printed as its own page. */
export function TestPaperPrintPage() {
  const { id = '' } = useParams();
  const { identity } = useAuth();
  const url = useFilters<'languages' | 'answerKey'>();
  const sheet = useRef<HTMLElement>(null);

  const mayPrintKey = identity?.isSuperAdmin === true;
  const languages = url.get('languages');
  const withKey = mayPrintKey && url.get('answerKey') === WITH_KEY;

  const paper = useQuery({
    queryKey: testPaperPrintQueryKey(id, languages, withKey),
    queryFn: () =>
      api.admin.tests.printablePaper(id, {
        ...(languages ? { languages } : {}),
        ...(withKey ? { answerKey: WITH_KEY } : {}),
      }),
    // Each read of a whole paper is logged against the reader, so it is never read again unasked.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });

  const filters = paperFilters(paper.data?.available ?? [], mayPrintKey);
  const { values, setFilter, clearFilters } = useFilterSpec(filters);
  const title = paper.data?.title ?? UNTITLED;

  return (
    <PageFrame
      header={
        <PageHeader
          breadcrumbs={
            <PageCrumbs
              nav={NAV_ITEMS}
              tail={[
                { label: title, to: ROUTES.TEST(id) },
                { label: 'Paper', to: ROUTES.TEST_PAPER(id) },
                { label: 'Print' },
              ]}
            />
          }
          title={title}
          meta={
            paper.data
              ? [
                  plural(paper.data.questions.length, 'question'),
                  `${paper.data.maxMarks} marks`,
                  durationLabel(paper.data.durationSec),
                ].join(' · ')
              : undefined
          }
          action={
            <Button
              size="sm"
              icon={<Printer aria-hidden />}
              // The sheet of the filters before these is still on screen, and is not the one asked for.
              disabled={!paper.data || paper.isPlaceholderData || paper.data.questions.length === 0}
              onClick={() => sheet.current && printElement(sheet.current, title)}
            >
              Print
            </Button>
          }
        />
      }
      filters={{ spec: filters, state: { values, setFilter, clearFilters } }}
    >
      <Body paper={paper} sheet={sheet} />
    </PageFrame>
  );
}

function Body({
  paper,
  sheet,
}: Readonly<{
  paper: { data?: PrintablePaper; isError: boolean; refetch: () => void };
  sheet: React.RefObject<HTMLElement | null>;
}>) {
  if (paper.isError) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Could not load this paper"
        onRetry={paper.refetch}
      />
    );
  }
  if (!paper.data) {
    return (
      <div className="flex flex-col gap-5">
        <Skeleton variant="title" />
        <SkeletonParagraph lines={10} />
      </div>
    );
  }
  if (paper.data.questions.length === 0) return <EmptyState title="No questions on the paper" />;

  return (
    <Card className="mx-auto w-full max-w-4xl p-8">
      <Sheet ref={sheet} paper={paper.data} />
    </Card>
  );
}

/** The page itself: everything inside this element is what reaches the printer, and nothing outside it. */
function Sheet({ paper, ref }: Readonly<{ paper: PrintablePaper; ref: React.Ref<HTMLElement> }>) {
  const numberOf = new Map(
    paper.questions.map((question) => [question.questionId, question.order]),
  );

  return (
    <article ref={ref} className="flex flex-col gap-6 text-sm text-foreground">
      <header className="flex flex-col gap-1 border-b border-border pb-4">
        <img src={SHEET_LOGO} alt={REPORT_LETTERHEAD} className="mb-2 h-7 w-auto self-start" />
        <h1 className="text-2xl font-bold tracking-tight">{paper.title ?? UNTITLED}</h1>
        <p className="text-muted-foreground">{paper.series}</p>
        <dl className="mt-2 flex flex-wrap gap-x-8 gap-y-1">
          <Fact label="Questions" value={paper.questions.length} />
          <Fact label="Maximum marks" value={paper.maxMarks} />
          <Fact label="Time" value={durationLabel(paper.durationSec)} />
        </dl>
      </header>

      {paper.sections.map((section) => (
        <section key={section.id} className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">{section.name}</h2>
          {paper.questions
            .filter((question) => question.baseConfigSectionId === section.id)
            .map((question) => (
              <PrintedQuestion key={question.questionId} question={question} paper={paper} />
            ))}
        </section>
      ))}

      {paper.answerKey ? (
        <section className="flex break-before-page flex-col gap-3">
          <h2 className="text-lg font-semibold">Answer key</h2>
          <ol className="grid grid-cols-4 gap-x-6 gap-y-1 tabular-nums">
            {paper.answerKey.map((keyed) => (
              <li key={keyed.questionId} className="flex gap-2">
                <span className="w-8 shrink-0 text-right font-semibold">
                  {numberOf.get(keyed.questionId)}.
                </span>
                {keyed.answer}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </article>
  );
}

function Fact({ label, value }: Readonly<{ label: string; value: React.ReactNode }>) {
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/** Never split across two pages: a candidate should not turn the sheet to find a question's options. */
function PrintedQuestion({
  question,
  paper,
}: Readonly<{ question: ExamQuestion; paper: PrintablePaper }>) {
  return (
    <div className="flex break-inside-avoid gap-3">
      <span className="w-8 shrink-0 text-right font-semibold tabular-nums">{question.order}.</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {paper.languages.map((language) => (
          <RichContent
            key={language}
            lang={language.toLowerCase()}
            html={htmlOf(question.content[contentLanguageOf(language)]?.stem)}
          />
        ))}
        {question.type === QUESTION_TYPE.TEXT_FIELD ? (
          <p className="pt-2">Answer: ____________________</p>
        ) : (
          <ol className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {question.options.map((option, place) => (
              <li key={option.id} className="flex gap-2">
                <span className="shrink-0 font-medium">({optionLetter(place)})</span>
                <div className="flex min-w-0 flex-col gap-1">
                  {paper.languages.map((language) => (
                    <RichContent
                      key={language}
                      lang={language.toLowerCase()}
                      html={htmlOf(option.text[contentLanguageOf(language)])}
                    />
                  ))}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
