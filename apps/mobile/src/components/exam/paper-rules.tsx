import { Text, View } from 'react-native';
import { paperRulesFor, type PaperTraits } from '@iace/app-kit';
import { cn } from '../../lib/cn';

/** The same rules the web prints, read from app-kit; ink classes let the sheet and the screen each use their own. */
export function PaperRules({
  inkClass = 'text-foreground',
  mutedClass = 'text-muted-foreground',
  ...traits
}: Readonly<PaperTraits & { inkClass?: string; mutedClass?: string }>) {
  return (
    <View className="gap-3">
      {paperRulesFor(traits).map((rule) => (
        <View key={rule.term}>
          <Text className={cn('text-sm font-medium', inkClass)}>{rule.term}</Text>
          <Text className={cn('text-sm leading-relaxed', mutedClass)}>{rule.says}</Text>
        </View>
      ))}
    </View>
  );
}
