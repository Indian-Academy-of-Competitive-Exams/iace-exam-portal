/// <reference types="nativewind/types" />
import { Modal, Text, View } from 'react-native';
import { Button } from './button';
import { Card } from './card';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** The consequence and the count — here the description IS the information. */
  description: string;
  confirmLabel: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Asks before an action that cannot be taken back. Android's back button is Cancel. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  loading = false,
  onConfirm,
  onCancel,
}: Readonly<ConfirmDialogProps>) {
  return (
    <Modal transparent visible={open} animationType="fade" onRequestClose={onCancel}>
      <View className="flex-1 items-center justify-center bg-[var(--overlay-bg)] p-6">
        <Card accessibilityRole="alert" className="w-full max-w-md gap-4 p-5">
          <Text className="text-lg font-semibold text-foreground">{title}</Text>
          <Text className="text-sm text-foreground">{description}</Text>
          <View className="flex-row justify-end gap-2">
            <Button variant="ghost" onPress={onCancel}>
              Cancel
            </Button>
            <Button loading={loading} onPress={onConfirm}>
              {confirmLabel}
            </Button>
          </View>
        </Card>
      </View>
    </Modal>
  );
}
