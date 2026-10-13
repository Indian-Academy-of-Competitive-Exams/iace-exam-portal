/** A finished practice session: the figure it is held to, the rest, and the typing marked word by word. */
import { Link } from 'react-router-dom';
import {
  TYPED_WORD,
  type TypedWord,
  type TypedWordKind,
  type TypingPreset,
  type TypingResult,
} from '@iace/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  PAGE_CONTENT_CLASS,
  PageFrame,
  PageHeader,
  StatRow,
  cn,
} from '@iace/ui';
import { Hero, HeroFigure, PageBody, Section } from '../../components/ui';
import { ROUTES } from '../../lib/constants';
import { METRIC_UNITS, headlineOf, mistakesOf, targetLabel } from './typing-figures';

const WORD_MARKS: Readonly<Record<TypedWordKind, { label: string; className: string }>> = {
  RIGHT: { label: 'Right', className: '' },
  HALF: { label: 'Half mistake', className: 'rounded bg-warning-subtle px-1 text-warning-ink' },
  WRONG: { label: 'Wrong word', className: 'rounded bg-destructive/[0.14] px-1 text-destructive' },
  EXTRA: {
    label: 'Extra word',
    className: 'rounded bg-destructive/[0.14] px-1 text-destructive line-through',
  },
  MISSED: {
    label: 'Missed word',
    className: 'rounded border border-dashed border-border px-1 text-muted-foreground',
  },
};

const MARKED_KINDS = [TYPED_WORD.HALF, TYPED_WORD.WRONG, TYPED_WORD.EXTRA, TYPED_WORD.MISSED];

export function TypingResultView({
  preset,
  result,
  saveFailed,
  saving,
  onSaveAgain,
  onTypeAnother,
}: Readonly<{
  preset: TypingPreset;
  result: TypingResult;
  saveFailed: boolean;
  saving: boolean;
  onSaveAgain: () => void;
  onTypeAnother: () => void;
}>) {
  return (
    // Outside the shell, so it brings the shell's own content wrapper with it.
    <div className={cn('flex h-dvh flex-col', PAGE_CONTENT_CLASS, 'max-w-5xl')}>
      <PageFrame header={<PageHeader title={preset.label} />}>
        <PageBody>
          {saveFailed ? (
            <Alert variant="danger">
              This session is not in your history.{' '}
              <Button variant="outline" size="sm" loading={saving} onClick={onSaveAgain}>
                Save it again
              </Button>
            </Alert>
          ) : null}

          <Hero
            eyebrow="Typing practice"
            figure={
              <HeroFigure
                value={headlineOf(preset, result).toLocaleString('en-IN')}
                unit={METRIC_UNITS[preset.metric]}
                caption={`Target ${targetLabel(preset)}`}
              />
            }
            aside={
              <div className="flex flex-col items-start gap-4 sm:items-end">
                <Badge variant={result.qualified ? 'success' : 'danger'}>
                  {result.qualified ? 'Qualified' : 'Not qualified'}
                </Badge>
                <div className="flex gap-2">
                  <Button asChild variant="outline">
                    <Link to={ROUTES.TYPING}>History</Link>
                  </Button>
                  <Button onClick={onTypeAnother}>Type another</Button>
                </div>
              </div>
            }
          />

          <Section title="Figures">
            <Card className="flex flex-col gap-3 p-5">
              <StatRow
                label="Key depressions"
                value={result.keyDepressions.toLocaleString('en-IN')}
              />
              <StatRow label="Words typed" value={result.wordsTyped.toLocaleString('en-IN')} />
              <StatRow label="Gross speed (words a minute)" value={result.grossWpm} />
              <StatRow label="Net speed (words a minute)" value={result.netWpm} />
              <StatRow label="Mistakes" value={mistakesOf(result)} />
              <StatRow label="Errors (%)" value={result.errorPct} />
            </Card>
          </Section>

          <Section
            title="Comparison"
            meta={
              <span className="flex flex-wrap gap-2">
                {MARKED_KINDS.map((kind) => (
                  <span key={kind} className={cn('text-xs', WORD_MARKS[kind].className)}>
                    {WORD_MARKS[kind].label}
                  </span>
                ))}
              </span>
            }
          >
            <Card className="p-5 text-base leading-loose">
              {result.words.map((word, index) => (
                <MarkedWord key={index} word={word} />
              ))}
            </Card>
          </Section>
        </PageBody>
      </PageFrame>
    </div>
  );
}

function MarkedWord({ word }: Readonly<{ word: TypedWord }>) {
  const mark = WORD_MARKS[word.kind];
  return (
    <>
      <span className={mark.className}>
        <span className="sr-only">{word.kind === TYPED_WORD.RIGHT ? '' : `${mark.label}: `}</span>
        {word.typed ?? word.expected}
      </span>
      {word.kind === TYPED_WORD.WRONG ? (
        <span className="text-success-ink"> ({word.expected})</span>
      ) : null}{' '}
    </>
  );
}
