/**
 * What a student reads before the clock starts — ported from the web's `test-instructions.tsx`.
 * It never starts the attempt: the exam screen calls `startAttempt` on arrival at `/exam/[testId]`.
 */
import { Fragment, useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ANSWER_STATES,
  contentLanguageOf,
  isStateShown,
  LANGUAGE_LABELS,
  languagesFor,
  NAVIGATION_POLICY,
  type ExamBrief,
  type LanguageCode,
  type NavigationPolicy,
} from '@iace/contracts';
import {
  ANSWER_STATE_LABELS,
  beginChoice,
  FORWARD_ONLY_NOTICE,
  isBriefRefused,
  PALETTE_SAYS,
} from '@iace/app-kit';
import { Text } from '../../../src/components/ui/text';
import { briefQuery, testPaperQuery } from '../../../src/lib/queries';
import { Alert } from '../../../src/components/ui/alert';
import { Button } from '../../../src/components/ui/button';
import { Card } from '../../../src/components/ui/card';
import { EmptyState, EMPTY_STATE_KINDS } from '../../../src/components/ui/empty-state';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { StatTile, StatTileRow } from '../../../src/components/ui/stat-tile';
import { AnsweredTick, PALETTE_LEGEND } from '../../../src/components/exam/question-palette';
import { SystemCheck } from '../../../src/components/tests/system-check';
import { EXAM_RESUME_PARAM } from '../../../src/lib/constants';
import { DETAIL_ROUTES } from '../../../src/lib/nav';
import { cn } from '../../../src/lib/cn';
import { plural } from '../../../src/lib/plural';
import { sectionLine } from '../../../src/lib/brief-lines';

type Phase = 'LOADING' | 'REFUSED' | 'ERROR' | 'READY';

/** A refusal replaces the screen whatever is held; any other failure only when nothing is. */
function phaseOf(brief: {
  isLoading: boolean;
  isError: boolean;
  isLoadingError: boolean;
  error: unknown;
}): Phase {
  if (brief.isLoading) return 'LOADING';
  if (brief.isError && isBriefRefused(brief.error)) return 'REFUSED';
  return brief.isLoadingError ? 'ERROR' : 'READY';
}

export default function TestInstructionsScreen() {
  const { id: testId, [EXAM_RESUME_PARAM]: resume } = useLocalSearchParams<{
    id: string;
    [EXAM_RESUME_PARAM]?: string;
  }>();
  const router = useRouter();
  const [declared, setDeclared] = useState(false);
  const [language, setLanguage] = useState<LanguageCode | ''>('');
  const [beginning, setBeginning] = useState(false);

  // Coming back from the paper offers Begin again; until then a second tap must not open a second paper.
  useFocusEffect(useCallback(() => () => setBeginning(false), []));

  const queryClient = useQueryClient();

  const brief = useQuery(briefQuery(testId));

  // Held while they read, so beginning is a small request and not a paper download at the same instant.
  const offered = brief.data;
  useEffect(() => {
    if (!offered) return;
    void queryClient.prefetchQuery(
      testPaperQuery(testId, languagesFor(offered.languageMode, offered.languages, undefined)),
    );
  }, [offered, testId, queryClient]);

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
          beginning={beginning}
          onBegin={(languages) => {
            setBeginning(true);
            router.push(DETAIL_ROUTES.EXAM(testId, languages, resume));
          }}
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
  beginning,
  onBegin,
}: Readonly<{
  phase: Phase;
  paper: ExamBrief | undefined;
  onRetry: () => void;
  declared: boolean;
  onDeclaredChange: (value: boolean) => void;
  language: LanguageCode | '';
  onLanguageChange: (value: LanguageCode) => void;
  beginning: boolean;
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

  const { dual, chosen, ready, languages } = beginChoice(paper, language, declared);

  return (
    <Fragment>
      <Text variant="title">{paper.title ?? 'Instructions'}</Text>

      <StatTileRow>
        <StatTile label="Duration" value={`${Math.round(paper.durationSec / 60)} min`} />
        <StatTile label="Questions" value={paper.totalQuestions} />
        <StatTile label="Sections" value={paper.sections.length} />
      </StatTileRow>

      <SectionsList paper={paper} />

      {paper.navigation === NAVIGATION_POLICY.FORWARD_ONLY ? (
        <Alert variant="warning">{FORWARD_ONLY_NOTICE}</Alert>
      ) : null}

      <PaletteCard navigation={paper.navigation} />

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

      <Button disabled={!ready || beginning} onPress={() => onBegin(languages)}>
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

function PaletteCard({ navigation }: Readonly<{ navigation: NavigationPolicy }>) {
  const forwardOnly = navigation === NAVIGATION_POLICY.FORWARD_ONLY;

  return (
    <View className="gap-2">
      <Text variant="section">Palette</Text>
      <Card className="gap-3 p-4">
        <Text variant="meta">{PALETTE_SAYS[navigation]}</Text>
        {/* The swatches are the exam skin's colours, which a screen outside the paper has to scope itself. */}
        <View className="exam-template-default gap-2">
          {ANSWER_STATES.filter((state) => isStateShown(state, forwardOnly)).map((state) => (
            <View key={state} className="flex-row items-center gap-3">
              <View className={cn('h-4 w-4 rounded-exam-cell', PALETTE_LEGEND[state].fill)}>
                <AnsweredTick state={state} />
              </View>
              <Text variant="body">{ANSWER_STATE_LABELS[state]}</Text>
            </View>
          ))}
        </View>
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

const dualLanguageNote = (paper: ExamBrief) =>
  `This paper is shown in ${paper.languages.map((code) => LANGUAGE_LABELS[contentLanguageOf(code)]).join(' and ')} together. There is nothing to choose.`;
