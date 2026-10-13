/** Where a descriptive answer is written: a plain box and its word count. It knows no clock and saves nothing. */
import type * as React from 'react';
import { TYPED_TEXT_MAX } from '@iace/contracts';
import { Textarea } from '@iace/ui';

const refuse = (event: React.SyntheticEvent) => event.preventDefault();

const wordsIn = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

export function WritingBox({
  value,
  onChange,
  onBlur,
  disabled = false,
}: Readonly<{
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
}>) {
  return (
    // The `typing-*` names let a skin's stylesheet dress this as it dresses the typing box.
    <div className="typing-pane flex flex-col gap-exam-gap">
      <Textarea
        // Remounted as it opens: a box that mounted disabled would never take the focus it asks for.
        key={disabled ? 'closed' : 'open'}
        aria-label="Write your answer here"
        autoFocus
        value={value}
        disabled={disabled}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        autoComplete="off"
        maxLength={TYPED_TEXT_MAX}
        onBlur={onBlur}
        // The real papers give no paste: the answer is written here, not brought in.
        onPaste={refuse}
        onDrop={refuse}
        onContextMenu={refuse}
        onChange={(event) => onChange(event.target.value)}
        className="typing-box h-72 resize-none border-exam-border bg-exam-surface text-base leading-loose text-exam-ink"
      />
      <dl className="typing-count flex shrink-0 gap-6 text-sm tabular-nums text-exam-ink">
        <div className="flex items-baseline gap-2">
          <dt className="text-exam-ink-muted">Words</dt>
          <dd className="font-semibold">{wordsIn(value).toLocaleString('en-IN')}</dd>
        </div>
      </dl>
    </div>
  );
}
