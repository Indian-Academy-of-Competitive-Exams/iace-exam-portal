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
  Field,
  PageFrame,
  PageHeader,
  SkeletonParagraph,
  StatRow,
  plural,
} from '@iace/ui';
import { api } from '../lib/api';
import { LANGUAGE_LABELS, PALETTE_LEGEND, ROUTES } from '../lib/constants';
import { SystemCheck } from '../components/system-check';

/** What a student reads before the clock starts. Nothing here starts it — the last button does. */

const minutes = (seconds: number) => `${Math.round(seconds / 60)} minutes`;

export function TestInstructionsPage() {
  const { testId = '' } = useParams();
  const navigate = useNavigate();
  const [declared, setDeclared] = useState(false);
  const [language, setLanguage] = useState<LanguageCode | ''>('');

  const brief = useQuery({
    queryKey: ['me', 'test-brief', testId],
    queryFn: () => api.me.testBrief(testId),
    enabled: testId !== '',
  });

  if (brief.isLoading) {
    return (
      <PageFrame header={<PageHeader title="Before you begin" />}>
        <SkeletonParagraph lines={6} />
      </PageFrame>
    );
  }

  if (!brief.data) {
    return (
      <PageFrame header={<PageHeader title="Before you begin" />}>
        <Alert variant="danger">This test is not open to you.</Alert>
      </PageFrame>
    );
  }

  const paper = brief.data;
  const dual = paper.languageMode === LANGUAGE_MODE.DUAL;
  const picked = dual || paper.languages.length <= 1 || language !== '';
  const ready = declared && picked;

  return (
    <PageFrame header={<PageHeader title={paper.title ?? 'Before you begin'} />}>
      <div className="flex flex-col gap-6 pb-6">
        <div className="grid gap-x-6 sm:grid-cols-2">
          <StatRow label="Duration" value={minutes(paper.durationSec)} />
          <StatRow label="Questions" value={String(paper.totalQuestions)} />
        </div>

        <Sections paper={paper} />

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            What the colours mean
          </h2>
          <div className="flex flex-wrap gap-2">
            {PALETTE_LEGEND.map((entry) => (
              <Badge key={entry.state} variant={entry.variant}>
                {entry.label}
              </Badge>
            ))}
          </div>
        </section>

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

        <Checkbox
          checked={declared}
          onChange={(event) => setDeclared(event.target.checked)}
          label="I have read the instructions and I am ready to begin"
          hint="The clock starts the moment you begin, and the server keeps it."
        />

        <Button
          type="button"
          disabled={!ready}
          className="self-start"
          onClick={() =>
            navigate(ROUTES.EXAM(testId), {
              state: { languages: dual ? paper.languages : [language] },
            })
          }
        >
          I am ready to begin
        </Button>
      </div>
    </PageFrame>
  );
}

function Sections({ paper }: Readonly<{ paper: ExamBrief }>) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold tracking-tight text-foreground">
        {plural(paper.sections.length, 'section')}
      </h2>
      <div className="flex flex-col gap-2">
        {paper.sections.map((section) => (
          <div
            key={section.id}
            className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-border p-3"
          >
            <span className="text-sm font-medium text-foreground">{section.name}</span>
            <span className="text-xs text-muted-foreground">
              {`${plural(section.questionCount, 'question')} · +${section.marksPerQuestion} / −${section.negativeMarks}${
                section.durationSec === null ? '' : ` · ${minutes(section.durationSec)}`
              }`}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
