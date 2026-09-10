import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LANGUAGE_MODE, type ExamBrief, type LanguageCode } from '@iace/contracts';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Combobox,
  EmptyState,
  EMPTY_STATE_KINDS,
  Field,
  Metric,
  PageFrame,
  PageHeader,
  SkeletonParagraph,
  plural,
} from '@iace/ui';
import { PageCrumbs, useFullscreen } from '@iace/app-kit/browser';
import { api } from '../lib/api';
import { LANGUAGE_LABELS, NAV_ITEMS, PALETTE_LEGEND, ROUTES } from '../lib/constants';
import { SystemCheck } from '../components/system-check';
import { DividedList, DividedRow, PageBody, Section, StatBand } from '../components/ui';

/** What a student reads before the clock starts. Nothing here starts it — the last button does. */

const minutes = (seconds: number) => `${Math.round(seconds / 60)} minutes`;

export function TestInstructionsPage() {
  const { testId = '' } = useParams();
  const navigate = useNavigate();
  const fullscreen = useFullscreen();
  const [declared, setDeclared] = useState(false);
  const [language, setLanguage] = useState<LanguageCode | ''>('');

  const brief = useQuery({
    queryKey: ['me', 'test-brief', testId],
    queryFn: () => api.me.testBrief(testId),
    enabled: testId !== '',
  });

  if (brief.isLoading) {
    return (
      <PageFrame
        header={<PageHeader breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />} title="Instructions" />}
      >
        <SkeletonParagraph lines={6} />
      </PageFrame>
    );
  }

  if (!brief.data) {
    return (
      <PageFrame
        header={<PageHeader breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />} title="Instructions" />}
      >
        <EmptyState kind={EMPTY_STATE_KINDS.REFUSED} title="This test is not open to you" />
      </PageFrame>
    );
  }

  const paper = brief.data;
  const dual = paper.languageMode === LANGUAGE_MODE.DUAL;
  const picked = dual || paper.languages.length <= 1 || language !== '';
  const ready = declared && picked;

  return (
    <PageFrame
      header={
        <PageHeader
          breadcrumbs={
            <PageCrumbs
              nav={NAV_ITEMS}
              tail={[{ label: paper.title ?? 'Test', to: ROUTES.TEST_ABOUT(testId) }]}
            />
          }
          size="display"
          title={paper.title ?? 'Instructions'}
        />
      }
    >
      <PageBody className="pb-6">
        <StatBand>
          <Metric label="Duration (minutes)" value={Math.round(paper.durationSec / 60)} size="sm" />
          <Metric label="Questions" value={paper.totalQuestions} size="sm" />
          <Metric label="Sections" value={paper.sections.length} size="sm" />
        </StatBand>

        <Sections paper={paper} />

        <Section title="Palette">
          <div className="flex flex-wrap gap-2">
            {PALETTE_LEGEND.map((entry) => (
              <Badge key={entry.state} variant={entry.variant}>
                {entry.label}
              </Badge>
            ))}
          </div>
        </Section>

        <SystemCheck />

        {dual ? (
          <Alert variant="info">
            {`This paper is shown in ${paper.languages.map((code) => LANGUAGE_LABELS[code]).join(' and ')} together. There is nothing to choose.`}
          </Alert>
        ) : (
          <Field htmlFor="exam-language" label="Language">
            {(control) => (
              <Combobox
                {...control}
                clearable={false}
                placeholder="Choose a language"
                value={language}
                onChange={(next) => setLanguage(next as LanguageCode)}
                items={paper.languages.map((code) => ({
                  value: code,
                  label: LANGUAGE_LABELS[code],
                }))}
              />
            )}
          </Field>
        )}

        {fullscreen.isSupported ? (
          <Alert variant="info">
            The paper opens full screen, and leaving it is recorded. Your mobile number is printed
            faintly across every question, so a photograph of one leads back to you.
          </Alert>
        ) : null}

        <Checkbox
          checked={declared}
          onChange={(event) => setDeclared(event.target.checked)}
          label="I have read the instructions and I am ready to begin"
          /* ui-copy-ok: consequence */ hint="The clock starts the moment you begin, and the server keeps it."
        />

        <Button
          type="button"
          disabled={!ready}
          className="self-start"
          onClick={() => {
            // Asked for HERE because entering needs a gesture, and this click is the only one.
            void fullscreen.enter();
            navigate(ROUTES.EXAM(testId), {
              state: { languages: dual ? paper.languages : [language] },
            });
          }}
        >
          I am ready to begin
        </Button>
      </PageBody>
    </PageFrame>
  );
}

function Sections({ paper }: Readonly<{ paper: ExamBrief }>) {
  return (
    <Section title="Sections" meta={plural(paper.sections.length, 'section')}>
      <DividedList>
        {paper.sections.map((section) => (
          <DividedRow key={section.id} title={section.name} meta={sectionLine(section)} />
        ))}
      </DividedList>
    </Section>
  );
}

function sectionLine(section: ExamBrief['sections'][number]): string {
  const clock = section.durationSec === null ? null : minutes(section.durationSec);
  return [
    plural(section.questionCount, 'question'),
    `+${section.marksPerQuestion} / −${section.negativeMarks}`,
    clock,
  ]
    .filter((part) => part !== null)
    .join(' · ');
}
