import * as React from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import {
  AArrowDown,
  AArrowUp,
  Bold,
  Italic,
  List,
  ListOrdered,
  ImagePlus,
  Table as TableIcon,
  Sigma,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Underline as UnderlineIcon,
} from 'lucide-react';
import { mathErrorIn } from '../../lib/rich-html';
import { cn } from '../../lib/utils';
import { Alert } from './alert';
import { Button } from './button';
import { Input } from './input';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { Label } from './label';
import type { MathFieldProps } from './math-field';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';
import { insertUploaded, type ImageLimits, type UploadImage } from './rich-text-image';
import { TEXT_SIZES, TEXT_SIZE_MARK, type TextSize } from './rich-text-size';
import { Skeleton } from './skeleton';

/** The mark buttons, in the order a writer reaches for them. */
const MARKS = [
  { name: 'bold', label: 'Bold', Icon: Bold },
  { name: 'italic', label: 'Italic', Icon: Italic },
  { name: 'underline', label: 'Underline', Icon: UnderlineIcon },
  { name: 'superscript', label: 'Superscript', Icon: SuperscriptIcon },
  { name: 'subscript', label: 'Subscript', Icon: SubscriptIcon },
] as const;

/** Steps either side of the paper's own size. Neither pressed IS normal, so there is no third button. */
const SIZES = [
  { size: TEXT_SIZES.SMALL, label: 'Smaller', Icon: AArrowDown },
  { size: TEXT_SIZES.LARGE, label: 'Larger', Icon: AArrowUp },
] as const;

const LISTS = [
  { name: 'bulletList', label: 'Bullet list', Icon: List },
  { name: 'orderedList', label: 'Numbered list', Icon: ListOrdered },
] as const;

/** Pressed reads the mark under the caret, so the toolbar says what the next keystroke will be. */
function ToolButton({
  label,
  active,
  onClick,
  children,
}: Readonly<{
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            'flex size-7 items-center justify-center rounded-sm text-muted-foreground',
            'transition-colors hover:bg-muted hover:text-foreground',
            'focus-visible:shadow-focus focus-visible:outline-none [&_svg]:size-4',
            active && 'bg-muted text-foreground',
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** MathLive's marker for a slot nobody typed in, which KaTeX would report as an unknown command. */
const EMPTY_SLOT = String.raw`\placeholder`;

/** The strict check a stored formula must pass, in words for someone who never saw LaTeX. */
function errorIn(latex: string): string | null {
  if (!latex.trim()) return null;
  return latex.includes(EMPTY_SLOT) ? 'Fill in every empty box' : mathErrorIn(latex);
}

/** What is left when the editor's chunk will not load: the formula typed as LaTeX. */
function LatexField({ value, onChange, invalid }: Readonly<MathFieldProps>) {
  return (
    <>
      <Alert variant="warning">
        The equation editor did not load. Save your work and reload the page.
      </Alert>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="latex">LaTeX</Label>
        <Input
          id="latex"
          autoFocus
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="\frac{a}{b}"
          invalid={invalid}
        />
      </div>
    </>
  );
}

// Falling back keeps the page: a failed chunk thrown to the page boundary costs the unsaved question.
const MathField = React.lazy(() => import('./math-field').catch(() => ({ default: LatexField })));

/** A real dialog rather than `prompt`, which the docs suggest and this repo forbids. */
function MathDialog({
  open,
  latex,
  editing,
  onLatexChange,
  onOpenChange,
  onSubmit,
}: Readonly<{
  open: boolean;
  latex: string;
  editing: boolean;
  onLatexChange: (latex: string) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
}>) {
  const error = errorIn(latex);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        // The field focuses itself once loaded; MathLive abandons a focus the dialog then moves.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Equation</DialogTitle>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3">
          <React.Suspense fallback={<Skeleton className="h-80" />}>
            <MathField value={latex} onChange={onLatexChange} invalid={Boolean(error)} />
          </React.Suspense>
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!latex.trim() || Boolean(error)} onClick={onSubmit}>
            {editing ? 'Update' : 'Insert'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** `pos` null means a new formula; a number is the node that was clicked. */
export interface MathDraft {
  latex: string;
  pos: number | null;
}

export interface RichTextToolbarProps {
  editor: Editor;
  /** An MCQ option is one line, so the list buttons would only ever break it. */
  singleLine?: boolean;
  /** Lifted, so opening the dialog SETS the value rather than an effect copying it in. */
  math: MathDraft | null;
  onMathChange: (math: MathDraft | null) => void;
  /** Absent means this field takes no images, so no button offers one. */
  onUploadImage?: UploadImage;
  imageLimits?: ImageLimits;
  /** At the bar's right end: a control over the whole box rather than the text in it. */
  end?: React.ReactNode;
  className?: string;
}

/** What a question's table starts as; rows and columns are added from the table itself. */
const NEW_TABLE = { rows: 3, cols: 3, withHeaderRow: true } as const;

export function RichTextToolbar({
  editor,
  singleLine,
  math,
  onMathChange,
  onUploadImage,
  imageLimits,
  end,
  className,
}: Readonly<RichTextToolbarProps>) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  // Subscribed, not read at render: the editor re-renders on a doc change alone, so a caret move would leave every button's pressed state behind.
  const pressed = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      marks: MARKS.filter(({ name }) => current.isActive(name)).map(({ name }) => name),
      sizes: SIZES.filter(({ size }) => current.isActive(TEXT_SIZE_MARK, { size })).map(
        ({ size }) => size,
      ),
      lists: LISTS.filter(({ name }) => current.isActive(name)).map(({ name }) => name),
    }),
  });

  type Chain = ReturnType<Editor['chain']>;
  // `.run()` is what commits it — a chain that is only built does nothing at all.
  const run = (act: (chain: Chain) => Chain) => act(editor.chain().focus()).run();

  // Pressing the step already under the caret takes it back off, which is what makes normal reachable.
  const setSize = (size: TextSize) =>
    editor.isActive(TEXT_SIZE_MARK, { size })
      ? run((chain) => chain.unsetMark(TEXT_SIZE_MARK))
      : run((chain) => chain.setMark(TEXT_SIZE_MARK, { size }));

  const choose = (file: File | undefined) => {
    if (file && onUploadImage) insertUploaded(editor.view, file, onUploadImage, imageLimits);
  };

  const submit = () => {
    if (!math?.latex.trim()) return;
    const { latex, pos } = math;

    if (pos === null) editor.chain().focus().insertInlineMath({ latex }).run();
    else {
      const at = editor.chain().setNodeSelection(pos);
      const display = editor.state.doc.nodeAt(pos)?.isBlock;
      const updated = display
        ? at.updateBlockMath({ latex, pos })
        : at.updateInlineMath({ latex, pos });
      updated.focus().run();
    }

    onMathChange(null);
  };

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-0.5 border-b border-border bg-surface py-2',
        className,
      )}
    >
      {MARKS.map(({ name, label, Icon }) => (
        <ToolButton
          key={name}
          label={label}
          active={pressed.marks.includes(name)}
          onClick={() => editor.chain().focus().toggleMark(name).run()}
        >
          <Icon aria-hidden />
        </ToolButton>
      ))}

      {SIZES.map(({ size, label, Icon }) => (
        <ToolButton
          key={size}
          label={label}
          active={pressed.sizes.includes(size)}
          onClick={() => setSize(size)}
        >
          <Icon aria-hidden />
        </ToolButton>
      ))}

      {singleLine
        ? null
        : LISTS.map(({ name, label, Icon }) => (
            <ToolButton
              key={name}
              label={label}
              active={pressed.lists.includes(name)}
              onClick={() => editor.chain().focus().toggleList(name, 'listItem').run()}
            >
              <Icon aria-hidden />
            </ToolButton>
          ))}

      {singleLine ? null : (
        <ToolButton
          label="Insert a table"
          active={false}
          onClick={() => run((chain) => chain.insertTable(NEW_TABLE))}
        >
          <TableIcon aria-hidden />
        </ToolButton>
      )}

      <ToolButton
        label="Equation"
        active={false}
        onClick={() => onMathChange({ latex: '', pos: null })}
      >
        <Sigma aria-hidden />
      </ToolButton>

      {onUploadImage ? (
        <>
          <ToolButton label="Image" active={false} onClick={() => fileRef.current?.click()}>
            <ImagePlus aria-hidden />
          </ToolButton>
          <input
            ref={fileRef}
            type="file"
            accept={imageLimits?.accept?.join(',')}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Cleared so the same file can be chosen twice, as FileDropzone does.
              event.target.value = '';
              choose(file);
            }}
          />
        </>
      ) : null}

      {end ? (
        <>
          <span className="flex-1" />
          {end}
        </>
      ) : null}

      <MathDialog
        open={math !== null}
        latex={math?.latex ?? ''}
        editing={math?.pos !== null && math !== null}
        onLatexChange={(latex) => onMathChange({ latex, pos: math?.pos ?? null })}
        onOpenChange={(next) => (next ? undefined : onMathChange(null))}
        onSubmit={submit}
      />
    </div>
  );
}
