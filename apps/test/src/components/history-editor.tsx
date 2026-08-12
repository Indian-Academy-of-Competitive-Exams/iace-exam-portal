import { useFieldArray, type Control, type FieldValues, type Path } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import { PROFILE_LIST_MAX } from '@iace/contracts';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@iace/ui';

/**
 * A list of rows a student adds to: schooling, or exams sat elsewhere.
 *
 * One component for both, because they are the same interaction — add a row,
 * fill some of it in, remove one you got wrong — and two copies would have
 * drifted the first time either changed.
 *
 * Every field inside a row is optional except the first. A student who
 * remembers sitting SSC CGL but not the year should be able to record that
 * rather than being stopped by a form that wants all of it.
 */
export function HistoryEditor<T extends FieldValues>({
  control,
  name,
  title,
  description,
  addLabel,
  columns,
  emptyRow,
}: Readonly<{
  control: Control<T>;
  name: Path<T>;
  title: string;
  description: string;
  addLabel: string;
  /** Rendered left to right. `width` is a Tailwind basis class. */
  columns: readonly { key: string; label: string; type?: 'text' | 'number'; width?: string }[];
  emptyRow: Record<string, string>;
}>) {
  const { fields, append, remove } = useFieldArray({ control, name: name as never });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing added yet.</p>
        ) : null}

        {fields.map((field, index) => (
          <div key={field.id} className="flex flex-wrap items-end gap-2">
            {columns.map((column) => (
              <label key={column.key} className={`flex flex-col gap-1 ${column.width ?? 'flex-1'}`}>
                <span className="text-xs text-muted-foreground">{column.label}</span>
                <input
                  type={column.type ?? 'text'}
                  // The design-system Input takes a Field wrapper; a row of
                  // eight labelled boxes would be a wall, so these are plain
                  // inputs carrying the same token classes.
                  className="h-9 w-full rounded-md border border-input bg-surface px-2 text-sm shadow-sm transition-[box-shadow,border-color] focus:border-ring focus:shadow-focus focus:outline-none"
                  {...control.register(`${name}.${index}.${column.key}` as Path<T>)}
                />
              </label>
            ))}

            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove row ${index + 1}`}
              onClick={() => remove(index)}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}

        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            // Capped so a profile cannot become a CV, and so a mistyped paste
            // cannot add a thousand rows to somebody's record.
            disabled={fields.length >= PROFILE_LIST_MAX}
            onClick={() => append(emptyRow as never)}
          >
            <Plus aria-hidden />
            {addLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
