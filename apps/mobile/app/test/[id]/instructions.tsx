/**
 * What a student reads before the clock starts — ported from the web's `test-instructions.tsx`.
 * It never starts the attempt: the exam screen calls `startAttempt` on arrival at `/exam/[testId]`.
 */
import { Fragment, useState } from 'react';
import { Pressable, ScrollView, Switch, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  contentLanguageOf,
  LANGUAGE_LABELS,
  LANGUAGE_MODE,
  type ExamBrief,
  type LanguageCode,
} from '@iace/contracts';
import { Text } from '../../../src/components/ui/text';
import { briefQuery } from '../../../src/lib/queries';
import { Alert } from '../../../src/components/ui/alert';
import { Button } from '../../../src/components/ui/button';
import { Card } from '../../../src/components/ui/card';
import { EmptyState, EMPTY_STATE_KINDS } from '../../../src/components/ui/empty-state';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { StatTile, StatTileRow } from '../../../src/components/ui/stat-tile';
import { SystemCheck } from '../../../src/components/tests/system-check';
import { DETAIL_ROUTES } from '../../../src/lib/nav';
import { isBriefRefused } from '../../../src/lib/exam-routes';
import { cn } from '../../../src/lib/cn';
import { plural } from '../../../src/lib/plural';

type Phase = 'LOADING' | 'REFUSED' | 'ERROR' | 'READY';

function phaseOf(brief: { isLoading: boolean; isError: boolean; error: unknown }): Phase {
  if (brief.isLoading) return 'LOADING';
  if (brief.isError) return isBriefRefused(brief.error) ? 'REFUSED' : 'ERROR';
  return 'READY';
}

export default function TestInstructionsScreen() {
  const { id: testId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [declared, setDeclared] = useState(false);
  const [language, setLanguage] = useState<LanguageCode | ''>('');

  const brief = useQuery(briefQuery(testId));

  return (
    <Fragment>
      <Stack.Screen options={{ title: brief.data?.title ?? 'Instructions' }} />
      <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-5 px-5 py-6">
        <InstructionsContent
          phase={phaseOf(brief)}
          paper={brief.data}
          onRetry={brief.refetch}
          declared={declared}
          onDeclaredChange={setDeclared}
          language={language}
          onLanguageChange={setLanguage}
          onBegin={(languages) => router.push(DETAIL_ROUTES.EXAM(testId, languages))}
        />
      </ScrollView>
    </Fragment>
  );
}

function InstructionsContent({
  phase,
  paper,
  onRetry,
  declared,
  onDeclaredChange,
  language,
  onLanguageChange,
  onBegin,
}: Readonly<{
  phase: Phase;
  paper: ExamBrief | undefined;
  onRetry: () => void;
  declared: boolean;
  onDeclaredChange: (value: boolean) => void;
  language: LanguageCode | '';
  onLanguageChange: (value: LanguageCode) => void;
  onBegin: (languages: readonly LanguageCode[]) => void;
}>) {
  if (phase === 'LOADING') {
    return (
      <View className="gap-3">
        <Skeleton className="h-8 w-2/3 rounded-md" />
        <Skeleton className="h-40 rounded-xl" />
      </View>
    );
  }

  if (phase === 'REFUSED') {
    return <EmptyState kind={EMPTY_STATE_KINDS.REFUSED} title="This test is not open to you" />;
  }

  if (phase === 'ERROR' || !paper) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="This test did not load"
        onRetry={onRetry}
      />
    );
  }

  const dual = paper.languageMode === LANGUAGE_MODE.DUAL;
  // A paper offering one language has nothing to choose, so it arrives chosen rather than skippable.
  const chosen = language || soleLanguageOf(paper);
  const ready = declared && (dual || chosen !== '');

  return (
    <Fragment>
      <Text variant="title">{paper.title ?? 'Instructions'}</Text>

      <StatTileRow>
        <StatTile label="Duration" value={`${Math.round(paper.durationSec / 60)} min`} />
        <StatTile label="Questions" value={paper.totalQuestions} />
        <StatTile label="Sections" value={paper.sections.length} />
      </StatTileRow>

      <SectionsList paper={paper} />

      <SystemCheck />

      <Alert>
        Leaving the app once the paper is open does not stop the clock, and your mobile number is
        printed faintly across every question.
      </Alert>

      {dual ? (
        <Alert>{dualLanguageNote(paper)}</Alert>
      ) : (
        <LanguagePicker paper={paper} chosen={chosen} onChange={onLanguageChange} />
      )}

      <Alert>The clock starts the moment you begin, and the server keeps it.</Alert>

      <Declaration declared={declared} onChange={onDeclaredChange} />

      <Button
        disabled={!ready}
        onPress={() => onBegin(dual ? paper.languages : [chosen as LanguageCode])}
      >
        I am ready to begin
      </Button>
    </Fragment>
  );
}

function SectionsList({ paper }: Readonly<{ paper: ExamBrief }>) {
  return (
    <View className="gap-2">
      <View className="flex-row items-baseline justify-between">
        <Text variant="section">Sections</Text>
        <Text variant="muted">{plural(paper.sections.length, 'section')}</Text>
      </View>
      <Card>
        {paper.sections.map((section, index) => (
          <View key={section.id} className={cn('gap-1 p-4', index > 0 && 'border-t border-border')}>
            <Text variant="label">{section.name}</Text>
            <Text variant="meta">{sectionLine(section)}</Text>
          </View>
        ))}
      </Card>
    </View>
  );
}

function LanguagePicker({
  paper,
  chosen,
  onChange,
}: Readonly<{
  paper: ExamBrief;
  chosen: LanguageCode | '';
  onChange: (value: LanguageCode) => void;
}>) {
  return (
    <View className="gap-2">
      <Text variant="metaStrong">Language</Text>
      <View className="flex-row flex-wrap gap-2">
        {paper.languages.map((code) => (
          <LanguageChip
            key={code}
            label={LANGUAGE_LABELS[contentLanguageOf(code)]}
            selected={code === chosen}
            onPress={() => onChange(code)}
          />
        ))}
      </View>
    </View>
  );
}

function LanguageChip({
  label,
  selected,
  onPress,
}: Readonly<{ label: string; selected: boolean; onPress: () => void }>) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={cn(
        'rounded-full border px-3 py-1.5',
        selected ? 'border-primary bg-primary-subtle' : 'border-border bg-surface',
      )}
    >
      <Text
        className={cn('text-xs font-medium', selected ? 'text-primary-ink' : 'text-foreground')}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Declaration({
  declared,
  onChange,
}: Readonly<{ declared: boolean; onChange: (value: boolean) => void }>) {
  const label = 'I have read the instructions and I am ready to begin';
  return (
    <View className="flex-row items-center gap-3 rounded-lg border border-border bg-surface p-4">
      <Switch value={declared} onValueChange={onChange} accessibilityLabel={label} />
      <Pressable className="flex-1" onPress={() => onChange(!declared)}>
        <Text variant="label">{label}</Text>
      </Pressable>
    </View>
  );
}

const soleLanguageOf = (paper: ExamBrief): LanguageCode | '' =>
  paper.languages.length === 1 ? (paper.languages[0] ?? '') : '';

const dualLanguageNote = (paper: ExamBrief) =>
  `This paper is shown in ${paper.languages.map((code) => LANGUAGE_LABELS[contentLanguageOf(code)]).join(' and ')} together. There is nothing to choose.`;

function sectionLine(section: ExamBrief['sections'][number]): string {
  const clock = section.durationSec === null ? null : `${Math.round(section.durationSec / 60)} min`;
  return [
    plural(section.questionCount, 'question'),
    `+${section.marksPerQuestion} / −${section.negativeMarks}`,
    clock,
  ]
    .filter((part) => part !== null)
    .join(' · ');
}
