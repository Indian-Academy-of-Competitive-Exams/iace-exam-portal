import * as React from 'react';
import { EditorContent, useEditor, type Editor, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { BlockMathAtDollars, InlineMathAtDollar } from './rich-text-math';
import { Superscript } from '@tiptap/extension-superscript';
import { Subscript } from '@tiptap/extension-subscript';
import { TableKit } from '@tiptap/extension-table';
import { type EditorView } from '@tiptap/pm/view';
import { cn } from '../../lib/utils';
import { TableTools } from './rich-text-table';
import { useFormDisabled } from './form-panel';
import { RichTextToolbar, type MathDraft } from './rich-text-toolbar';
import {
  QuestionImage,
  imageFilesIn,
  insertUploadedInto,
  type ImageLimits,
  type UploadImage,
} from './rich-text-image';

export interface RichTextProps {
  value: string;
  onChange: (html: string) => void;
  /** Overrides the surrounding `FormPanel`; a field the record owns can be read-only on its own. */
  disabled?: boolean;
  /** Tags the content for `:lang()`, which is what gives Telugu its taller line box. */
  lang?: string;
  /** One line of prose, no block tools — an MCQ option is not a document. */
  singleLine?: boolean;
  /** Given one, the editor takes images; without it there is no image button and paste falls through. */
  onUploadImage?: UploadImage;
  /** What the server will accept, so a file it would refuse is refused here first. */
  imageLimits?: ImageLimits;
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  className?: string;
}

/** Text that already carries markup, as opposed to a plain string typed before this editor existed. */
function looksLikeHtml(value: string): boolean {
  return /<[a-z][\s\S]*>/i.test(value);
}

/** Plain text never goes through the HTML parser: a stem reading "x < 5" would lose the rest. */
function documentFrom(value: string): string | JSONContent {
  if (looksLikeHtml(value)) return value;
  if (!value) return '';
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }],
  };
}

/** True when it swallowed the event, which is what stops ProseMirror inlining the bytes itself. */
function takeImages(
  view: EditorView,
  data: DataTransfer | null,
  upload: UploadImage | undefined,
  limits: ImageLimits | undefined,
): boolean {
  if (!upload) return false;
  const files = imageFilesIn(data);
  if (files.length === 0) return false;

  for (const file of files) insertUploadedInto(view, file, upload, limits);
  return true;
}

const SHELL = [
  'w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-foreground shadow-sm',
  'transition-[box-shadow,border-color] focus-within:border-ring focus-within:shadow-focus',
  'aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-within:shadow-focus-invalid',
].join(' ');

const OFF = 'cursor-not-allowed border-disabled-border bg-disabled text-disabled-foreground';

/** ProseMirror owns the inner element, so its own classes go on through `editorProps`. */
const CONTENT = 'rich-content outline-none [&_.ProseMirror]:outline-none [&_p]:m-0';

export function RichText({
  value,
  onChange,
  disabled,
  lang,
  singleLine = false,
  onUploadImage,
  imageLimits,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  className,
}: Readonly<RichTextProps>) {
  const off = useFormDisabled() || (disabled ?? false);
  const [math, setMath] = React.useState<MathDraft | null>(null);
  // The editor emits an update for its INITIAL content, which is a load and not a keystroke.
  const settled = React.useRef(false);

  const editor = useEditor({
    editable: !off,
    extensions: [
      StarterKit.configure(
        singleLine ? { heading: false, bulletList: false, orderedList: false } : {},
      ),
      Superscript,
      Subscript,
      ...(singleLine ? [] : [TableKit.configure({ table: { resizable: true } }), TableTools]),
      ...(onUploadImage ? [QuestionImage] : []),
      // A half-typed formula shows in red rather than taking the editor down with it.
      BlockMathAtDollars.configure({ katexOptions: { throwOnError: false } }),
      InlineMathAtDollar.configure({
        katexOptions: { throwOnError: false },
        onClick: (node, pos) => setMath({ latex: String(node.attrs.latex ?? ''), pos }),
      }),
    ],
    content: documentFrom(value),
    onUpdate: ({ editor: current }: { editor: Editor }) => {
      if (!settled.current) return;
      onChange(current.getHTML());
    },
    editorProps: {
      // Without these a pasted image becomes a base64 `data:` uri inside the question row.
      handlePaste: (view, event) =>
        takeImages(view, event.clipboardData, onUploadImage, imageLimits),
      handleDrop: (view, event) =>
        takeImages(view, (event as DragEvent).dataTransfer, onUploadImage, imageLimits),
      attributes: {
        class: cn(CONTENT, singleLine && 'whitespace-nowrap'),
        ...(id ? { id } : {}),
        ...(lang ? { lang } : {}),
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        ...(invalid ? { 'aria-invalid': 'true' } : {}),
      },
    },
  });

  // `false`: it defaults to re-emitting the CURRENT document, which reads as the user typing it.
  React.useEffect(() => {
    editor?.setEditable(!off, false);
  }, [editor, off]);

  // After the editor exists, so its creation update has already been and gone.
  React.useEffect(() => {
    if (editor) settled.current = true;
  }, [editor]);

  // Only when the two genuinely differ, or every keystroke would reset the caret to the start.
  React.useEffect(() => {
    if (!editor || value === editor.getHTML()) return;
    // `emitUpdate: false` or loading a question reads as the user typing it — v3 emits by default.
    editor.commands.setContent(documentFrom(value), { emitUpdate: false });
  }, [editor, value]);

  return (
    <div
      className={cn(SHELL, !singleLine && 'min-h-24', off && OFF, className)}
      data-focus-ring="wrapper"
      aria-invalid={invalid}
    >
      {/* No toolbar when it is read-only: a row of inert buttons says nothing the grey does not. */}
      {editor && !off ? (
        <RichTextToolbar
          editor={editor}
          singleLine={singleLine}
          math={math}
          onMathChange={setMath}
          onUploadImage={onUploadImage}
          imageLimits={imageLimits}
        />
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
}
