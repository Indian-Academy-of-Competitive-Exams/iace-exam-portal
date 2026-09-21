/**
 * The palette as a bottom sheet: what each colour means, then every question in
 * the section drawn in it. The legend and the cells read one table, so the key
 * a student is shown can never disagree with the grid it explains.
 */
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ANSWER_STATE, ANSWER_STATES, type AnswerState } from '@iace/contracts';
import { type ExamView } from '@iace/app-kit';
import { cn } from '../../lib/cn';
import { Button } from '../ui/button';

interface PaletteEntry {
  label: string;
  fill: string;
  ink: string;
}

/** The five states, their names and their colours — the palette's only source of any of them. */
const PALETTE_LEGEND: Readonly<Record<AnswerState, PaletteEntry>> = {
  [ANSWER_STATE.NOT_VISITED]: {
    label: 'Not visited',
    fill: 'bg-exam-notvisited',
    ink: 'text-exam-notvisited-ink',
  },
  [ANSWER_STATE.NOT_ANSWERED]: {
    label: 'Not answered',
    fill: 'bg-exam-notanswered',
    ink: 'text-exam-notanswered-ink',
  },
  [ANSWER_STATE.ANSWERED]: {
    label: 'Answered',
    fill: 'bg-exam-answered',
    ink: 'text-exam-answered-ink',
  },
  [ANSWER_STATE.MARKED_REVIEW]: {
    label: 'Marked for review',
    fill: 'bg-exam-marked',
    ink: 'text-exam-marked-ink',
  },
  [ANSWER_STATE.ANSWERED_MARKED]: {
    label: 'Answered and marked',
    fill: 'bg-exam-answered-marked',
    ink: 'text-exam-answered-marked-ink',
  },
};

export function QuestionPalette({
  view,
  open,
  onClose,
}: Readonly<{ view: ExamView; open: boolean; onClose: () => void }>) {
  const currentId = view.question?.questionId ?? null;
  const insets = useSafeAreaInsets();

  return (
    <Modal transparent visible={open} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-[var(--overlay-bg)]">
        <Pressable accessibilityLabel="Close" className="flex-1" onPress={onClose} />
        <View
          className="max-h-[85%] gap-4 rounded-t-2xl bg-exam-surface pt-2"
          // The last row of numbers stays above the home indicator, never under it.
          style={{ paddingBottom: Math.max(insets.bottom, 24) }}
        >
          <View className="flex-row items-center justify-between px-4">
            <Text className="text-lg font-semibold text-exam-ink">Question palette</Text>
            <Button variant="ghost" onPress={onClose}>
              Close
            </Button>
          </View>

          <View className="gap-2 px-4">
            {ANSWER_STATES.map((state) => (
              <View key={state} className="flex-row items-center gap-3">
                <View className={cn('h-4 w-4 rounded-exam-cell', PALETTE_LEGEND[state].fill)} />
                <Text className="flex-1 text-sm text-exam-ink">{PALETTE_LEGEND[state].label}</Text>
                <Text className="text-sm font-semibold tabular-nums text-exam-ink">
                  {(view.sectionCounts[view.sectionId] ?? view.counts)[state]}
                </Text>
              </View>
            ))}
          </View>

          <ScrollView
            className="shrink grow-0"
            contentContainerClassName="flex-row flex-wrap gap-2 px-4"
          >
            {view.questions.map((row, index) => (
              <PaletteCell
                key={row.questionId}
                number={index + 1}
                state={view.answers[row.questionId]?.state ?? ANSWER_STATE.NOT_VISITED}
                current={row.questionId === currentId}
                onPress={() => {
                  view.openQuestion(row.questionId);
                  onClose();
                }}
              />
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function PaletteCell({
  number,
  state,
  current,
  onPress,
}: Readonly<{ number: number; state: AnswerState; current: boolean; onPress: () => void }>) {
  const { label, fill, ink } = PALETTE_LEGEND[state];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Question ${number}, ${label}`}
      accessibilityState={{ selected: current }}
      onPress={onPress}
      className={cn(
        'h-11 w-11 items-center justify-center rounded-exam-cell border-2',
        fill,
        // Positional only: a ring, never a fill, so it cannot read as a state.
        current ? 'border-exam-current' : 'border-transparent',
      )}
    >
      <Text className={cn('text-sm font-semibold tabular-nums', ink)}>{number}</Text>
    </Pressable>
  );
}
