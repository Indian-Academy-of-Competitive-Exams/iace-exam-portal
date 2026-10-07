import { type CSSProperties } from 'react';
import {
  get,
  useFieldArray,
  useFormState,
  type Control,
  type FieldError,
  type FieldValues,
  type Path,
} from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import { PROFILE_LIST_MAX } from '@iace/contracts';
import { Button, EmptyState, FormSection, Input, Label, cn } from '@iace/ui';

const COLUMN_LABEL = 'text-xs font-normal text-muted-foreground';

/** Rows for schooling or exams sat elsewhere; only the first field is required. A GRID, not flex, or one long name pushes a row's columns out of line. */
export function HistoryEditor<T extends FieldValues>({
  control,
  name,
  title,
  addLabel,
  columns,
  empty,
  emptyRow,
}: Readonly<{
  control: Control<T>;
  name: Path<T>;
  title: string;
  addLabel: string;
  /** What the section says when the student has added nothing yet. */
  empty: string;
  /** `span` is a fraction of the row; they need not add up to anything. */
  columns: readonly { key: string; label: string; type?: 'text' | 'number'; span?: number }[];
  emptyRow: Record<string, string>;
}>) {
  const { fields, append, remove } = useFieldArray({ control, name: name as never });
  const { errors } = useFormState({ control, name });

  // The delete button gets a fixed column of its own, so it lands under itself on every row.
  const track = (span: number) => `minmax(0, ${span}fr)`;
  const template = `${columns.map((c) => track(c.span ?? 1)).join(' ')} auto`;

  return (
    <FormSection title={title}>
      <div className="flex flex-col gap-4">
        {fields.length === 0 ? <EmptyState level={3} size="sm" title={empty} /> : null}

        {fields.map((field, index) => (
          <div
            key={field.id}
            // The columns apply from `lg` up; below it a row has one, so its boxes stack.
            className="grid items-start gap-3 lg:grid-cols-[var(--history-columns)] lg:gap-x-2 lg:gap-y-1.5"
            style={{ '--history-columns': template } as CSSProperties}
          >
            {/* Headed on the first row only: repeating "Year" down a column says nothing new. */}
            {index === 0 ? (
              <>
                {columns.map((column) => (
                  <Label
                    key={column.key}
                    htmlFor={`${name}.0.${column.key}`}
                    className={cn(COLUMN_LABEL, 'hidden self-end lg:block')}
                  >
                    {column.label}
                  </Label>
                ))}
                {/* Takes the delete column, so the boxes start a line of their own. */}
                <span className="hidden lg:block" />
              </>
            ) : null}

            {columns.map((column) => {
              const id = `${name}.${index}.${column.key}`;
              const message = (get(errors, id) as FieldError | undefined)?.message;
              return (
                <div key={column.key} className="flex min-w-0 flex-col gap-1.5">
                  {/* A stacked row has no heading above it, so every box says what it is. */}
                  <Label htmlFor={id} className={cn(COLUMN_LABEL, 'lg:hidden')}>
                    {column.label}
                  </Label>
                  <Input
                    id={id}
                    type={column.type ?? 'text'}
                    aria-label={column.label}
                    aria-describedby={message ? `${id}-message` : undefined}
                    invalid={Boolean(message)}
                    {...control.register(id as Path<T>)}
                  />
                  {message ? (
                    <p id={`${id}-message`} role="alert" className="text-xs text-destructive">
                      {message}
                    </p>
                  ) : null}
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
            // Capped so a profile cannot become a CV, or a mistyped paste add a thousand rows.
            disabled={fields.length >= PROFILE_LIST_MAX}
            onClick={() => append(emptyRow as never)}
          >
            <Plus aria-hidden />
            {addLabel}
          </Button>
        </div>
      </div>
    </FormSection>
  );
}
