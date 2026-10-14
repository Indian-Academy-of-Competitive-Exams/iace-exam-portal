import { Text, View } from 'react-native';

/** Enough repeats to reach the corners of a tall phone without measuring it. */
const WATERMARK_TILES = Array.from({ length: 24 }, (_, index) => index);

/** The one thing on the paper that leads back to a person, faint enough to read through. */
export function PaperWatermark({ text }: Readonly<{ text: string }>) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="pointer-events-none absolute inset-0 flex-row flex-wrap content-around justify-around overflow-hidden"
    >
      {WATERMARK_TILES.map((tile) => (
        <Text
          key={tile}
          className="w-1/3 -rotate-45 py-6 text-center text-xs text-exam-ink opacity-5"
        >
          {text}
        </Text>
      ))}
    </View>
  );
}
