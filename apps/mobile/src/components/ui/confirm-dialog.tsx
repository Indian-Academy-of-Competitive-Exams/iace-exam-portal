/// <reference types="nativewind/types" />
import { Modal, View } from 'react-native';
import { useUnstableNativeVariable } from 'nativewind';
import TriangleAlert from 'lucide-react-native/icons/triangle-alert';
import { Text } from './text';
import { Button } from './button';
import { Card } from './card';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** The consequence and the count — here the description IS the information. */
  description: string;
  confirmLabel: string;
  /** Crimson button, warning glyph — for anything that destroys or revokes. */
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Asks before an action that cannot be taken back. Android's back button is Cancel; neither answers while it is in flight. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}: Readonly<ConfirmDialogProps>) {
  const glyph = useUnstableNativeVariable('--destructive');
  return (
    <Modal
      transparent
      visible={open}
      animationType="fade"
      onRequestClose={loading ? undefined : onCancel}
    >
      <View className="flex-1 items-center justify-center bg-[var(--overlay-bg)] p-6">
        <Card accessibilityRole="alert" className="w-full max-w-md gap-4 p-5">
          {destructive ? (
            <View className="h-10 w-10 items-center justify-center rounded-full bg-destructive-subtle">
              <TriangleAlert size={20} color={typeof glyph === 'string' ? glyph : undefined} />
            </View>
          ) : null}
          <Text variant="section">{title}</Text>
          <Text variant="body">{description}</Text>
          <View className="flex-row justify-end gap-2">
            <Button variant="secondary" disabled={loading} onPress={onCancel}>
              Cancel
            </Button>
            <Button
              variant={destructive ? 'destructive' : 'default'}
              loading={loading}
              onPress={onConfirm}
            >
              {confirmLabel}
            </Button>
          </View>
        </Card>
      </View>
    </Modal>
  );
}
