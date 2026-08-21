import { useFieldArray, type Control, type FieldValues, type Path } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import { PROFILE_LIST_MAX } from '@iace/contracts';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@iace/ui';

/**
 * Rows a student adds to: schooling, or exams sat elsewhere. Every field but the first
 * is optional. A GRID, not flex, or one long name pushes that row's columns out of line.
 */
export function HistoryEditor<T extends FieldValues>({
  control,
  name,
  title,
  addLabel,
  columns,
  emptyRow,
}: Readonly<{
  control: Control<T>;
  name: Path<T>;
  title: string;
  addLabel: string;
  /** `span` is a fraction of the row; they need not add up to anything. */
  columns: readonly { key: string; label: string; type?: 'text' | 'number'; span?: number }[];
  emptyRow: Record<string, string>;
}>) {
  const { fields, append, remove } = useFieldArray({ control, name: name as never });

  // The delete button gets a fixed column of its own, so it lands under itself
  // on every row instead of wherever the last input left it.
  const track = (span: number) => `minmax(0, ${span}fr)`;
  const template = `${columns.map((c) => track(c.span ?? 1)).join(' ')} auto`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing added yet.</p>
        ) : null}

        {fields.map((field, index) => (
          <div
            key={field.id}
            // items-end so the controls sit on one baseline whatever their
            // labels wrapped to, and the delete button lines up with them.
            className="grid items-end gap-2"
            style={{ gridTemplateColumns: template }}
          >
            {columns.map((column) => {
              const id = `${name}.${index}.${column.key}`;
              return (
                <div key={column.key} className="flex min-w-0 flex-col gap-1.5">
                  {/* Labelled on the first row only: repeating "Year" down a
                      column says nothing the header did not already. */}
                  {index === 0 ? (
                    <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
                      {column.label}
                    </Label>
                  ) : null}
                  <Input
                    id={id}
                    type={column.type ?? 'text'}
                    aria-label={column.label}
                    {...control.register(id as Path<T>)}
                  />
                </div>
              );
            })}

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
