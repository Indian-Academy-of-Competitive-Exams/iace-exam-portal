import * as React from 'react';
import katex from 'katex';
import { type Editor } from '@tiptap/react';
import {
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
import { cn } from '../../lib/utils';
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
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';
import { insertUploaded, type ImageLimits, type UploadImage } from './rich-text-image';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu';

/** The mark buttons, in the order a writer reaches for them. */
const MARKS = [
  { name: 'bold', label: 'Bold', Icon: Bold },
  { name: 'italic', label: 'Italic', Icon: Italic },
  { name: 'underline', label: 'Underline', Icon: UnderlineIcon },
  { name: 'superscript', label: 'Superscript', Icon: SuperscriptIcon },
  { name: 'subscript', label: 'Subscript', Icon: SubscriptIcon },
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

/** In a table the row and column actions apply; out of one only inserting does. */
function TableMenu({ editor }: Readonly<{ editor: Editor }>) {
  const inTable = editor.isActive('table');
  type Chain = ReturnType<Editor['chain']>;
  // `.run()` is what commits it — a chain that is only built does nothing at all.
  const run = (act: (chain: Chain) => Chain) => () => {
    act(editor.chain().focus()).run();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Table"
          className={cn(
            'flex size-7 items-center justify-center rounded-sm text-muted-foreground',
            'transition-colors hover:bg-muted hover:text-foreground',
            'focus-visible:shadow-focus focus-visible:outline-none [&_svg]:size-4',
            inTable && 'bg-muted text-foreground',
          )}
        >
          <TableIcon aria-hidden />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start">
        {inTable ? null : (
          <DropdownMenuItem
            onSelect={run((chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))}
          >
            Insert a table
          </DropdownMenuItem>
        )}

        {inTable ? (
          <>
            <DropdownMenuItem onSelect={run((chain) => chain.addRowBefore())}>
              Row above
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={run((chain) => chain.addRowAfter())}>
              Row below
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={run((chain) => chain.addColumnBefore())}>
              Column left
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={run((chain) => chain.addColumnAfter())}>
              Column right
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={run((chain) => chain.deleteRow())}>
              Delete row
            </DropdownMenuItem>
            <DropdownMenuItem destructive onSelect={run((chain) => chain.deleteColumn())}>
              Delete column
            </DropdownMenuItem>
            <DropdownMenuItem destructive onSelect={run((chain) => chain.deleteTable())}>
              Delete table
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Parsed strictly to JUDGE it, rendered loosely to SHOW it — a half-typed formula still previews. */
function parse(latex: string): { html: string; error: string | null } {
  const html = katex.renderToString(latex || '', { throwOnError: false, displayMode: false });
  if (!latex.trim()) return { html, error: null };

  try {
    katex.renderToString(latex, { throwOnError: true, strict: 'error' });
    return { html, error: null };
  } catch (error) {
    return { html, error: (error as Error).message.replace('KaTeX parse error: ', '') };
  }
}

/** The LaTeX box. A real dialog rather than `prompt`, which the docs suggest and this repo forbids. */
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
  const { html, error } = parse(latex);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Equation</DialogTitle>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="latex">LaTeX</Label>
            <Input
              id="latex"
              autoFocus
              value={latex}
              onChange={(event) => onLatexChange(event.target.value)}
              placeholder="\frac{a}{b}"
              invalid={Boolean(error)}
            />
            {error ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <div className="flex min-h-20 items-center justify-center overflow-x-auto rounded-md border border-border bg-surface-2 px-3 py-2 text-xl">
            <span
              aria-label="Preview"
              // KaTeX's own output, from LaTeX this dialog owns — no user HTML reaches here.
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
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
}

export function RichTextToolbar({
  editor,
  singleLine,
  math,
  onMathChange,
  onUploadImage,
  imageLimits,
}: Readonly<RichTextToolbarProps>) {
  const fileRef = React.useRef<HTMLInputElement>(null);

  const choose = (file: File | undefined) => {
    if (file && onUploadImage) insertUploaded(editor, file, onUploadImage, imageLimits);
  };

  const submit = () => {
    if (!math?.latex.trim()) return;
    const { latex, pos } = math;

    if (pos === null) editor.chain().focus().insertInlineMath({ latex }).run();
    else editor.chain().setNodeSelection(pos).updateInlineMath({ latex }).focus().run();

    onMathChange(null);
  };

  return (
    <div className="mb-2 flex flex-wrap items-center gap-0.5 border-b border-border pb-2">
      {MARKS.map(({ name, label, Icon }) => (
        <ToolButton
          key={name}
          label={label}
          active={editor.isActive(name)}
          onClick={() => editor.chain().focus().toggleMark(name).run()}
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
              active={editor.isActive(name)}
              onClick={() => editor.chain().focus().toggleList(name, 'listItem').run()}
            >
              <Icon aria-hidden />
            </ToolButton>
          ))}

      {singleLine ? null : <TableMenu editor={editor} />}

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
