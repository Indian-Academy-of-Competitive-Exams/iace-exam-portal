import * as React from 'react';
import { MathfieldElement } from 'mathlive';
import { cn } from '../../lib/utils';

// katex.css already serves these faces under the same names, and a key press needs no sound file.
MathfieldElement.fontsDirectory = null;
MathfieldElement.soundsDirectory = null;

export interface MathFieldProps {
  value: string;
  onChange: (latex: string) => void;
  invalid: boolean;
}

/** The app's tokens over MathLive's own palette, which follows the OS theme rather than ours. */
const KEYBOARD = [
  // The panel measures its keys without its own top padding, so any padding clips the last row.
  'relative shrink-0 overflow-hidden rounded-md [--keyboard-padding-top:0px]',
  '[--keyboard-accent-color:var(--primary)] [--keyboard-background:var(--surface-2)]',
  '[--keyboard-toolbar-text:var(--foreground)] [--keycap-background:var(--surface)]',
  '[--keycap-background-hover:var(--surface-hover)] [--keycap-text:var(--foreground)]',
  '[--keycap-secondary-background:var(--surface-active)]',
  '[--keycap-secondary-background-hover:var(--surface-hover)]',
  '[--keycap-secondary-text:var(--foreground)]',
].join(' ');

/** The formula drawn as it is typed, with the keyboard of templates held open beneath it. */
export default function MathField({ value, onChange, invalid }: Readonly<MathFieldProps>) {
  const field = React.useRef<MathfieldElement>(null);
  const keys = React.useRef<HTMLDivElement>(null);
  // The element reads its text once, so a re-render must not hand it a second copy.
  const [initial] = React.useState(value);

  React.useEffect(() => {
    const host = keys.current;
    if (!host) return;

    const keyboard = window.mathVirtualKeyboard;
    // The dialog scales in, and a rect read mid-animation is scaled with it; offsetWidth is not.
    const fit = () => {
      const scale = host.getBoundingClientRect().width / host.offsetWidth;
      host.style.height = `${keyboard.boundingRect.height / scale}px`;
    };

    keyboard.container = host;
    keyboard.addEventListener('geometrychange', fit);
    keyboard.show();
    field.current?.executeCommand('moveToMathfieldEnd');
    field.current?.focus();

    return () => {
      keyboard.removeEventListener('geometrychange', fit);
      keyboard.hide();
      keyboard.container = document.body;
    };
  }, []);

  return (
    <>
      {/* createElement, since naming a custom element for JSX takes a global namespace. */}
      {React.createElement(
        'math-field',
        {
          ref: field,
          'aria-label': 'Formula',
          'aria-invalid': invalid,
          'math-virtual-keyboard-policy': 'manual',
          className: cn(
            'block w-full rounded-md border border-input bg-surface px-3 py-2 text-xl',
            'text-foreground shadow-sm outline-none transition-[box-shadow,border-color]',
            'focus-within:border-ring focus-within:shadow-focus',
            'aria-[invalid=true]:border-destructive',
            'aria-[invalid=true]:focus-within:shadow-focus-invalid',
            '[&::part(menu-toggle)]:hidden [&::part(virtual-keyboard-toggle)]:hidden',
          ),
          // Expanded, so MathLive's own shorthands reach KaTeX as commands it knows.
          onInput: (event: React.SyntheticEvent<MathfieldElement>) =>
            onChange(event.currentTarget.getValue('latex-expanded')),
        },
        initial,
      )}
      <div ref={keys} className={KEYBOARD} />
    </>
  );
}
