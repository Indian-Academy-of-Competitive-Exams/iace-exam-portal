/**
 * Rows a student adds to: schooling, or exams sat elsewhere. Every field but the
 * first is optional. One card per row rather than the web's grid — a phone has no
 * room for five columns, and a row that wraps mid-column reads as two rows.
 */
/// <reference types="nativewind/types" />
import { Pressable, Text, View } from 'react-native';
import {
  useFieldArray,
  type Control,
  type FieldValues,
  type Path,
  type ArrayPath,
} from 'react-hook-form';
import { PROFILE_LIST_MAX } from '@iace/contracts';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { TextField } from '../ui/text-field';

export interface HistoryColumn {
  key: string;
  label: string;
  numeric?: boolean;
}

export interface HistoryEditorProps<TValues extends FieldValues> {
  control: Control<TValues>;
  name: ArrayPath<TValues>;
  title: string;
  addLabel: string;
  /** What the section says when the student has added nothing yet. */
  empty: string;
  columns: readonly HistoryColumn[];
  emptyRow: Record<string, string>;
}

export function HistoryEditor<TValues extends FieldValues>({
  control,
  name,
  title,
  addLabel,
  empty,
  columns,
  emptyRow,
}: Readonly<HistoryEditorProps<TValues>>) {
  const { fields, append, remove } = useFieldArray({ control, name });

  return (
    <View className="gap-3">
      <Text className="text-lg font-semibold text-foreground">{title}</Text>

      {fields.length === 0 ? <Text className="text-sm text-muted-foreground">{empty}</Text> : null}

      {fields.map((field, index) => (
        <Card key={field.id} className="gap-3 p-4">
          {columns.map((column) => (
            <TextField
              key={column.key}
              control={control}
              name={`${name}.${index}.${column.key}` as Path<TValues>}
              label={column.label}
              keyboardType={column.numeric ? 'number-pad' : 'default'}
            />
          ))}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove row ${index + 1}`}
            onPress={() => remove(index)}
            className="self-start py-1"
          >
            <Text className="text-xs font-medium text-destructive">Remove</Text>
          </Pressable>
        </Card>
      ))}

      <Button
        variant="outline"
        size="sm"
        // Capped so a profile cannot become a CV, and a mistyped paste cannot add a thousand rows.
        disabled={fields.length >= PROFILE_LIST_MAX}
        onPress={() => append(emptyRow as never)}
      >
        {addLabel}
      </Button>
    </View>
  );
}
