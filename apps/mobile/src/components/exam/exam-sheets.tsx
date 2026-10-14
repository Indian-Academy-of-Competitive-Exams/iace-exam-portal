/** The three things a candidate opens mid-sitting without leaving it: the calculator, the paper and the rules. */
import { type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ANSWER_STATES,
  contentLanguageOf,
  isStateShown,
  previewTextOf,
  TEST_UI,
} from '@iace/contracts';
import {
  ANSWER_STATE_LABELS,
  CALCULATOR_KEYPAD,
  htmlOf,
  shownLanguages,
  TIMER_KIND,
  useCalculator,
  type ExamView,
} from '@iace/app-kit';
import { type LucideIcon } from 'lucide-react-native';
import { cn } from '../../lib/cn';
import { useTokenColor } from '../../lib/use-token-color';
import { Button } from '../ui/button';
import { PaperRules } from './paper-rules';
import { PaperWatermark } from './paper-watermark';
import { AnsweredTick, PALETTE_LEGEND } from './question-palette';
import X from 'lucide-react-native/icons/x';
import Calculator from 'lucide-react-native/icons/calculator';
import FileText from 'lucide-react-native/icons/file-text';
import BookOpen from 'lucide-react-native/icons/book-open';

const KEY_CLASS =
  'h-12 items-center justify-center rounded-exam-cell border border-exam-border bg-exam-surface';

function ExamSheet({
  open,
  title,
  icon: Icon,
  onClose,
  children,
}: Readonly<{
  open: boolean;
  title: string;
  icon: LucideIcon;
  onClose: () => void;
  children: ReactNode;
}>) {
  const insets = useSafeAreaInsets();
  const ink = useTokenColor('--foreground');

  return (
    <Modal transparent visible={open} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-[var(--overlay-bg)]">
        <Pressable accessibilityLabel="Close" className="flex-1" onPress={onClose} />
        <View
          className="max-h-[85%] gap-3 rounded-t-2xl bg-exam-surface pt-2"
          style={{ paddingBottom: Math.max(insets.bottom, 24) }}
        >
          <View className="flex-row items-center justify-between px-4">
            <View className="flex-1 flex-row items-center gap-2">
              <Icon size={20} color={ink} />
              <Text numberOfLines={1} className="flex-1 text-lg font-semibold text-exam-ink">
                {title}
              </Text>
            </View>
            <Button variant="ghost" icon={X} onPress={onClose}>
              Close
            </Button>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

export function CalculatorSheet({
  open,
  onClose,
}: Readonly<{ open: boolean; onClose: () => void }>) {
  const { display, press } = useCalculator();
  const tall = CALCULATOR_KEYPAD.find((entry) => entry.span === 'TALL');
  const top = CALCULATOR_KEYPAD.slice(0, 12);
  const rest = CALCULATOR_KEYPAD.slice(12).filter((entry) => entry !== tall);

  const key = (entry: (typeof CALCULATOR_KEYPAD)[number], className?: string) => (
    <View key={entry.key} className={cn('p-0.5', className)}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={entry.key}
        onPress={() => press(entry.key)}
        className={cn(KEY_CLASS, entry.span === 'TALL' && 'h-full flex-1 bg-exam-surface-2')}
      >
        <Text
          className={cn(
            'text-lg text-exam-ink',
            entry.operator ? 'font-semibold text-exam-current' : 'font-medium',
          )}
        >
          {entry.key}
        </Text>
      </Pressable>
    </View>
  );

  return (
    <ExamSheet open={open} title="Calculator" icon={Calculator} onClose={onClose}>
      <View className="gap-2 px-4">
        <Text
          accessibilityLiveRegion="polite"
          numberOfLines={1}
          className="rounded-exam-cell border border-exam-border px-3 py-2 text-right font-mono text-2xl text-exam-ink"
        >
          {display}
        </Text>
        <View className="flex-row flex-wrap">{top.map((entry) => key(entry, 'w-1/4'))}</View>
        <View className="flex-row">
          <View className="w-3/4 flex-row flex-wrap">
            {rest.map((entry) => key(entry, entry.span === 'WIDE' ? 'w-2/3' : 'w-1/3'))}
          </View>
          {tall ? key(tall, 'w-1/4') : null}
        </View>
      </View>
    </ExamSheet>
  );
}

export function PaperSheet({
  view,
  open,
  onClose,
}: Readonly<{ view: ExamView; open: boolean; onClose: () => void }>) {
  const language = shownLanguages(view.languages, view.languageMode)[0];

  return (
    <ExamSheet open={open} title={view.title ?? 'Question paper'} icon={FileText} onClose={onClose}>
      <View className="relative shrink">
        <ScrollView className="shrink grow-0" contentContainerClassName="px-4">
          {view.questions.map((question, index) => (
            <View
              key={question.questionId}
              className="flex-row gap-4 border-b border-exam-border py-3"
            >
              <Text className="w-10 text-sm text-exam-ink-muted">{`Q.${index + 1}`}</Text>
              <Text className="flex-1 text-sm leading-relaxed text-exam-ink">
                {language
                  ? previewTextOf(htmlOf(question.content[contentLanguageOf(language)]?.stem))
                  : ''}
              </Text>
            </View>
          ))}
        </ScrollView>
        {view.watermark ? <PaperWatermark text={view.watermark} /> : null}
      </View>
    </ExamSheet>
  );
}

export function RulesSheet({
  view,
  open,
  onClose,
}: Readonly<{ view: ExamView; open: boolean; onClose: () => void }>) {
  return (
    <ExamSheet open={open} title="Instructions" icon={BookOpen} onClose={onClose}>
      <ScrollView className="shrink grow-0" contentContainerClassName="gap-4 px-4">
        <PaperRules
          inkClass="text-exam-ink"
          mutedClass="text-exam-ink-muted"
          forwardOnly={view.forwardOnly}
          sectional={view.timer.kind === TIMER_KIND.SECTION}
          omr={view.testUi === TEST_UI.OMR}
        />
        <View className="gap-2">
          {ANSWER_STATES.filter((state) => isStateShown(state, view.forwardOnly)).map((state) => (
            <View key={state} className="flex-row items-center gap-3">
              <View className={cn('h-4 w-4 rounded-exam-cell', PALETTE_LEGEND[state].fill)}>
                <AnsweredTick state={state} />
              </View>
              <Text className="text-sm text-exam-ink">{ANSWER_STATE_LABELS[state]}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </ExamSheet>
  );
}
