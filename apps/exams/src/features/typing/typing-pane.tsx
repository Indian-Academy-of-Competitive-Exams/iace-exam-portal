/** The typing screen itself: the passage above, the box below. It knows no clock and saves nothing. */
import type * as React from 'react';
import { TYPED_TEXT_MAX, typingKeyDepressions } from '@iace/contracts';
import { Textarea, cn } from '@iace/ui';

const ERASING_KEYS: ReadonlySet<string> = new Set(['Backspace', 'Delete']);

const refuse = (event: React.SyntheticEvent) => event.preventDefault();

export function TypingPane({
  passage,
  value,
  onChange,
  backspace,
  disabled = false,
  className,
}: Readonly<{
  passage: string;
  value: string;
  onChange: (next: string) => void;
  /** False where the board gives no way to correct: what is typed stays typed. */
  backspace: boolean;
  disabled?: boolean;
  className?: string;
}>) {
  const keyDepressions = typingKeyDepressions(passage, value);

  return (
    // The `typing-*` names are for a skin's own stylesheet; the default skin needs none of them.
    <div
      className={cn(
        'typing-pane flex h-full min-h-0 flex-1 flex-col gap-exam-gap p-exam',
        className,
      )}
    >
      <section
        aria-label="Passage"
        onCopy={refuse}
        onContextMenu={refuse}
        className="typing-passage relative min-h-0 flex-1 select-none overflow-y-auto rounded-exam-option border border-exam-border bg-exam-surface-2 p-exam text-base leading-loose text-exam-ink"
      >
        {passage}
      </section>

      <Textarea
        // Remounted as it opens: a box that mounted disabled would never take the focus it asks for.
        key={disabled ? 'closed' : 'open'}
        aria-label="Type the passage here"
        autoFocus
        value={value}
        disabled={disabled}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        autoComplete="off"
        maxLength={TYPED_TEXT_MAX}
        onPaste={refuse}
        onDrop={refuse}
        onContextMenu={refuse}
        onKeyDown={(event) => {
          if (!backspace && ERASING_KEYS.has(event.key)) event.preventDefault();
        }}
        // Typing over a selection erases too, so without backspace only what extends the text is kept.
        onChange={(event) => {
          if (backspace || event.target.value.startsWith(value)) onChange(event.target.value);
        }}
        className="typing-box h-48 shrink-0 resize-none border-exam-border bg-exam-surface text-base leading-loose text-exam-ink"
      />

      <dl className="typing-count flex shrink-0 gap-6 text-sm tabular-nums text-exam-ink">
        <div className="flex items-baseline gap-2">
          <dt className="text-exam-ink-muted">Key depressions</dt>
          <dd className="font-semibold">{keyDepressions.toLocaleString('en-IN')}</dd>
        </div>
      </dl>
    </div>
  );
}
