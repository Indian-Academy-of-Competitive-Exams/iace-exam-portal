import * as React from 'react';
import katex from 'katex';
import { type Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  List,
  ListOrdered,
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

/** KaTeX renders whatever it is given; `throwOnError` off means a half-typed formula shows as red. */
function preview(latex: string): string {
  return katex.renderToString(latex || '', { throwOnError: false, displayMode: false });
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
            />
          </div>

          <div className="flex min-h-14 items-center justify-center rounded-md border border-border bg-surface-2 px-3 py-2">
            <span
              aria-label="Preview"
              // KaTeX's own output, from LaTeX this dialog owns — no user HTML reaches here.
              dangerouslySetInnerHTML={{ __html: preview(latex) }}
            />
          </div>
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!latex.trim()} onClick={onSubmit}>
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
}

export function RichTextToolbar({
  editor,
  singleLine,
  math,
  onMathChange,
}: Readonly<RichTextToolbarProps>) {
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

      <ToolButton
        label="Equation"
        active={false}
        onClick={() => onMathChange({ latex: '', pos: null })}
      >
        <Sigma aria-hidden />
      </ToolButton>

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
