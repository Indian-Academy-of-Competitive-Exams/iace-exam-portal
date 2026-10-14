/// <reference types="nativewind/types" />
import { useState } from 'react';
import { Modal, View } from 'react-native';
import Route from 'lucide-react-native/icons/route';
import { EXAM_MODE_LABELS, type ExamBrief } from '@iace/contracts';
import { Text } from '../ui/text';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { cn } from '../../lib/cn';
import { useTokenColor } from '../../lib/use-token-color';
import X from 'lucide-react-native/icons/x';

/** The exam's stages in order, with the one this paper prepares for marked. */
export function ExamJourney({ journey }: Readonly<{ journey: NonNullable<ExamBrief['journey']> }>) {
  const [open, setOpen] = useState(false);
  const ink = useTokenColor('--foreground');

  return (
    <>
      <Button variant="outline" icon={Route} onPress={() => setOpen(true)}>
        Exam journey
      </Button>

      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <View className="flex-1 items-center justify-center bg-[var(--overlay-bg)] p-6">
          <Card className="w-full max-w-md gap-4 p-5">
            <View className="gap-1">
              <View className="flex-row items-center gap-2">
                <Route size={20} color={ink} />
                <Text variant="section">Exam journey</Text>
              </View>
              <Text variant="muted">{journey.exam}</Text>
            </View>

            {journey.stages.map((stage, index) => {
              const current = stage.id === journey.stageId;
              return (
                <View key={stage.id} className="flex-row items-center gap-3">
                  <View
                    className={cn(
                      'h-7 w-7 items-center justify-center rounded-full border',
                      current ? 'border-primary bg-primary' : 'border-border',
                    )}
                  >
                    <Text
                      className={cn(
                        'text-xs font-semibold',
                        current ? 'text-primary-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {index + 1}
                    </Text>
                  </View>
                  <View className="flex-1">
                    <Text numberOfLines={1} className="text-sm font-medium text-foreground">
                      {stage.name}
                    </Text>
                    <Text variant="meta">{EXAM_MODE_LABELS[stage.mode]}</Text>
                  </View>
                  {current ? <Badge variant="primary">This test</Badge> : null}
                </View>
              );
            })}

            <Button variant="secondary" icon={X} onPress={() => setOpen(false)}>
              Close
            </Button>
          </Card>
        </View>
      </Modal>
    </>
  );
}
