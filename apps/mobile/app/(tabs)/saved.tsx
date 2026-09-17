/// <reference types="nativewind/types" />
import { useState } from 'react';
import { Text, View } from 'react-native';
import {
  SAVED_QUESTION_KIND,
  SAVED_QUESTION_KIND_LABELS,
  SAVED_QUESTION_KINDS,
  type SavedQuestionKind,
} from '@iace/contracts';
import { ChipRow, type ChipOption } from '../../src/components/ui/chip-row';
import { SavedList } from '../../src/components/saved/saved-list';

const KINDS: readonly ChipOption[] = SAVED_QUESTION_KINDS.map((kind) => ({
  value: kind,
  label: SAVED_QUESTION_KIND_LABELS[kind],
}));

/** The two lists a student keeps of the bank: what they starred, and what they got wrong. */
export default function SavedScreen() {
  const [kind, setKind] = useState<SavedQuestionKind>(SAVED_QUESTION_KIND.BOOKMARK);

  return (
    <View className="flex-1 bg-background">
      <View className="gap-3 px-5 pt-6">
        <Text className="text-3xl font-bold tracking-tight text-foreground">Saved questions</Text>
        <ChipRow options={KINDS} value={kind} onChange={(next) => setKind(asKind(next))} />
      </View>

      <SavedList key={kind} kind={kind} />
    </View>
  );
}

const asKind = (value: string): SavedQuestionKind =>
  (SAVED_QUESTION_KINDS as readonly string[]).includes(value)
    ? (value as SavedQuestionKind)
    : SAVED_QUESTION_KIND.BOOKMARK;
