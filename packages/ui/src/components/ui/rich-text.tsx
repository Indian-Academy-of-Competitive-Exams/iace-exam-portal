import * as React from 'react';
import { EditorContent, useEditor, type Editor, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Mathematics } from '@tiptap/extension-mathematics';
import { Superscript } from '@tiptap/extension-superscript';
import { Subscript } from '@tiptap/extension-subscript';
import { cn } from '../../lib/utils';
import { useFormDisabled } from './form-panel';
import { RichTextToolbar, type MathDraft } from './rich-text-toolbar';
import { QuestionImage, imageFilesIn, insertUploaded, type UploadImage } from './rich-text-image';

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
  view: unknown,
  data: DataTransfer | null,
  upload: UploadImage | undefined,
): boolean {
  if (!upload) return false;
  const files = imageFilesIn(data);
  if (files.length === 0) return false;

  const editor = (view as unknown as { editor: Parameters<typeof insertUploaded>[0] }).editor;
  for (const file of files) insertUploaded(editor, file, upload);
  return true;
}

const SHELL = [
  'w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-foreground shadow-sm',
  'transition-[box-shadow,border-color] focus-within:border-ring focus-within:shadow-focus',
  'aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-within:shadow-focus-invalid',
].join(' ');

const OFF = 'cursor-not-allowed border-disabled-border bg-disabled text-disabled-foreground';

/** ProseMirror owns the inner element, so its own classes go on through `editorProps`. */
const CONTENT = 'outline-none [&_.ProseMirror]:outline-none [&_p]:m-0';

export function RichText({
  value,
  onChange,
  disabled,
  lang,
  singleLine = false,
  onUploadImage,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  className,
}: Readonly<RichTextProps>) {
  const off = useFormDisabled() || (disabled ?? false);
  const [math, setMath] = React.useState<MathDraft | null>(null);

  const editor = useEditor({
    editable: !off,
    extensions: [
      StarterKit.configure(
        singleLine ? { heading: false, bulletList: false, orderedList: false } : {},
      ),
      Superscript,
      Subscript,
      ...(onUploadImage ? [QuestionImage] : []),
      Mathematics.configure({
        // A half-typed formula shows in red rather than taking the editor down with it.
        katexOptions: { throwOnError: false },
        inlineOptions: {
          onClick: (node, pos) => setMath({ latex: String(node.attrs.latex ?? ''), pos }),
        },
      }),
    ],
    content: documentFrom(value),
    onUpdate: ({ editor: current }: { editor: Editor }) => onChange(current.getHTML()),
    editorProps: {
      // Without these a pasted image becomes a base64 `data:` uri inside the question row.
      handlePaste: (view, event) => takeImages(view, event.clipboardData, onUploadImage),
      handleDrop: (view, event) =>
        takeImages(view, (event as DragEvent).dataTransfer, onUploadImage),
      attributes: {
        class: cn(CONTENT, singleLine && 'whitespace-nowrap'),
        ...(id ? { id } : {}),
        ...(lang ? { lang } : {}),
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        ...(invalid ? { 'aria-invalid': 'true' } : {}),
      },
    },
  });

  React.useEffect(() => {
    editor?.setEditable(!off);
  }, [editor, off]);

  // Only when the two genuinely differ, or every keystroke would reset the caret to the start.
  React.useEffect(() => {
    if (editor && value !== editor.getHTML()) editor.commands.setContent(documentFrom(value));
  }, [editor, value]);

  return (
    <div
      className={cn(SHELL, !singleLine && 'min-h-24', off && OFF, className)}
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
        />
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
}
