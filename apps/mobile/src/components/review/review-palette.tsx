/**
 * The review's palette as a bottom sheet: how each question went, and every one
 * of them drawn in it. Three verdicts, not the sitting's five states — after
 * marking, whether a question was flagged for review no longer decides anything.
 */
/// <reference types="nativewind/types" />
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cn } from '../../lib/cn';
import { Button } from '../ui/button';
import { VERDICT, verdictOf, type ReviewedQuestion, type Verdict } from './review-protocol';

interface VerdictStyle {
  label: string;
  fill: string;
  ink: string;
}

/** The three verdicts, their names and their colours — the only source of either. */
export const VERDICT_STYLE: Readonly<Record<Verdict, VerdictStyle>> = {
  [VERDICT.RIGHT]: { label: 'Correct', fill: 'bg-success-subtle', ink: 'text-success-ink' },
  [VERDICT.WRONG]: {
    label: 'Incorrect',
    fill: 'bg-destructive',
    ink: 'text-destructive-foreground',
  },
  [VERDICT.LEFT]: { label: 'Unattempted', fill: 'bg-muted', ink: 'text-muted-foreground' },
};

const VERDICTS: readonly Verdict[] = [VERDICT.RIGHT, VERDICT.WRONG, VERDICT.LEFT];

export interface ReviewPaletteProps {
  questions: readonly ReviewedQuestion[];
  openId: string;
  open: boolean;
  onClose: () => void;
  onOpenQuestion: (questionId: string) => void;
}

export function ReviewPalette({
  questions,
  openId,
  open,
  onClose,
  onOpenQuestion,
}: Readonly<ReviewPaletteProps>) {
  const insets = useSafeAreaInsets();

  return (
    <Modal transparent visible={open} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-[var(--overlay-bg)]">
        <Pressable accessibilityLabel="Close" className="flex-1" onPress={onClose} />
        <View
          className="max-h-[85%] gap-4 rounded-t-2xl bg-surface pt-2"
          // The last row of numbers stays above the home indicator, never under it.
          style={{ paddingBottom: Math.max(insets.bottom, 24) }}
        >
          <View className="flex-row items-center justify-between px-4">
            <Text className="text-lg font-semibold text-foreground">Questions</Text>
            <Button variant="ghost" onPress={onClose}>
              Close
            </Button>
          </View>

          <View className="gap-2 px-4">
            {VERDICTS.map((verdict) => (
              <View key={verdict} className="flex-row items-center gap-3">
                <View className={cn('h-4 w-4 rounded-sm', VERDICT_STYLE[verdict].fill)} />
                <Text className="flex-1 text-sm text-foreground">
                  {VERDICT_STYLE[verdict].label}
                </Text>
                <Text className="text-sm font-semibold text-foreground">
                  {questions.filter((row) => verdictOf(row) === verdict).length}
                </Text>
              </View>
            ))}
          </View>

          <ScrollView
            className="shrink grow-0"
            contentContainerClassName="flex-row flex-wrap gap-2 px-4"
          >
            {questions.map((row) => (
              <PaletteCell
                key={row.questionId}
                number={row.order}
                verdict={verdictOf(row)}
                current={row.questionId === openId}
                onPress={() => {
                  onOpenQuestion(row.questionId);
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
  verdict,
  current,
  onPress,
}: Readonly<{ number: number; verdict: Verdict; current: boolean; onPress: () => void }>) {
  const { label, fill, ink } = VERDICT_STYLE[verdict];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Question ${number}, ${label}`}
      accessibilityState={{ selected: current }}
      onPress={onPress}
      className={cn(
        'h-11 w-11 items-center justify-center rounded-md border-2',
        fill,
        // Positional only: a ring, never a fill, so it cannot read as a verdict.
        current ? 'border-primary' : 'border-transparent',
      )}
    >
      <Text className={cn('text-sm font-semibold', ink)}>{number}</Text>
    </Pressable>
  );
}
