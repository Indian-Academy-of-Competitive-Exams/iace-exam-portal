/**
 * The palette as a bottom sheet: what each colour means, then every question in
 * the section drawn in it. The legend and the cells read one table, so the key
 * a student is shown can never disagree with the grid it explains.
 */
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ANSWER_STATE, ANSWER_STATES, isStateShown, type AnswerState } from '@iace/contracts';
import { ANSWER_STATE_LABELS, type ExamView } from '@iace/app-kit';
import { cn } from '../../lib/cn';
import { Button } from '../ui/button';

interface PaletteEntry {
  fill: string;
  ink: string;
}

/** The five states and their colours; app-kit names them, so the two clients cannot label one differently. */
export const PALETTE_LEGEND: Readonly<Record<AnswerState, PaletteEntry>> = {
  [ANSWER_STATE.NOT_VISITED]: {
    fill: 'bg-exam-notvisited',
    ink: 'text-exam-notvisited-ink',
  },
  [ANSWER_STATE.NOT_ANSWERED]: {
    fill: 'bg-exam-notanswered',
    ink: 'text-exam-notanswered-ink',
  },
  [ANSWER_STATE.ANSWERED]: {
    fill: 'bg-exam-answered',
    ink: 'text-exam-answered-ink',
  },
  [ANSWER_STATE.MARKED_REVIEW]: {
    fill: 'bg-exam-marked',
    ink: 'text-exam-marked-ink',
  },
  [ANSWER_STATE.ANSWERED_MARKED]: {
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
            {ANSWER_STATES.filter((state) => isStateShown(state, view.forwardOnly)).map((state) => (
              <View key={state} className="flex-row items-center gap-3">
                <View className={cn('h-4 w-4 rounded-exam-cell', PALETTE_LEGEND[state].fill)}>
                  <AnsweredTick state={state} />
                </View>
                <Text className="flex-1 text-sm text-exam-ink">{ANSWER_STATE_LABELS[state]}</Text>
                <Text className="text-sm font-semibold tabular-nums text-exam-ink">
                  {view.sectionCounts(view.sectionId)[state]}
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
                closed={!view.canOpen(row.questionId)}
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
  closed,
  onPress,
}: Readonly<{
  number: number;
  state: AnswerState;
  current: boolean;
  /** Left behind on a forward-only paper, so it is shown and not offered. */
  closed: boolean;
  onPress: () => void;
}>) {
  const { fill, ink } = PALETTE_LEGEND[state];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Question ${number}, ${ANSWER_STATE_LABELS[state]}`}
      accessibilityState={{ selected: current, disabled: closed }}
      disabled={closed}
      onPress={onPress}
      className={cn(
        'h-11 w-11 items-center justify-center rounded-exam-cell border-2',
        fill,
        closed && 'opacity-50',
        // Positional only: a ring, never a fill, so it cannot read as a state.
        current ? 'border-exam-current' : 'border-transparent',
      )}
    >
      <Text className={cn('text-sm font-semibold tabular-nums', ink)}>{number}</Text>
      <AnsweredTick state={state} />
    </Pressable>
  );
}

/** A flag with an answer banked under it has the same body as a bare flag; this dot is what tells them apart. */
export function AnsweredTick({ state }: Readonly<{ state: AnswerState }>) {
  if (state !== ANSWER_STATE.ANSWERED_MARKED) return null;
  return (
    <View className="absolute bottom-0 right-0 h-2/5 w-2/5 rounded-full border border-exam-surface bg-exam-answered-marked-tick" />
  );
}
