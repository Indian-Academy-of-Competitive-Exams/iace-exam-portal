import * as React from 'react';
import { MathfieldElement } from 'mathlive';
import { cn } from '../../lib/utils';
import { KEY_NAMES, Shortcut } from './kbd';
import { SectionHeading } from './section-heading';

// katex.css already serves these faces under the same names, and a key press needs no sound file.
MathfieldElement.fontsDirectory = null;
MathfieldElement.soundsDirectory = null;

export interface MathFieldProps {
  value: string;
  onChange: (latex: string) => void;
  invalid: boolean;
  /** Enter, with the formula as the field holds it now: its own events trail a fast typist. */
  onSubmit: (latex: string) => void;
  /** What Enter does, in the word the dialog's own button uses. */
  submitLabel: string;
  /** Drawn straight under the field, which is where the dialog says what is wrong with it. */
  children?: React.ReactNode;
}

/** Geometry every paper uses and MathLive ships no typed shortcut for. */
const OWN_SHORTCUTS = {
  ang: String.raw`\angle`,
  tri: String.raw`\triangle`,
  perp: String.raw`\perp`,
} as const;

interface ShortcutGroup {
  title: string;
  /** The keys, then what they give; one string is a run typed as it reads. */
  items: readonly (readonly [keys: string | readonly string[], gives: string])[];
}

/** Typed as they read, from MathLive's own table and the three above. */
const TYPED: readonly ShortcutGroup[] = [
  {
    title: 'Structures',
    items: [
      ['/', 'Fraction'],
      ['^', 'Power'],
      ['_', 'Subscript'],
      ['sqrt', '√'],
      ['cbrt', '∛'],
      ['nthroot', 'ⁿ√'],
      ['sum', 'Σ'],
      ['prod', '∏'],
      ['int', '∫'],
      ['lim', 'Limit'],
      ['log', 'logₐ'],
      ['floor', '⌊ ⌋'],
    ],
  },
  {
    title: 'Symbols',
    items: [
      ['xx', '×'],
      ['-:', '÷'],
      ['*', '·'],
      ['+-', '±'],
      ['!=', '≠'],
      ['<=', '≤'],
      ['>=', '≥'],
      ['~~', '≈'],
      ['~=', '≅'],
      ['-=', '≡'],
      ['prop', '∝'],
      ['oo', '∞'],
      ['deg', '°'],
      ['ang', '∠'],
      ['tri', '△'],
      ['perp', '⊥'],
      ['||', '‖'],
      [':.', '∴'],
      ['->', '→'],
      ['=>', '⇒'],
      ['<=>', '⇔'],
      ['...', '…'],
      ['in', '∈'],
      ['!in', '∉'],
      ['sub', '⊂'],
      ['uu', '∪'],
      ['nn', '∩'],
      ['AA', '∀'],
    ],
  },
  {
    title: 'Greek',
    items: [
      ['pi', 'π'],
      ['theta', 'θ'],
      ['alpha', 'α'],
      ['beta', 'β'],
      ['gamma', 'γ'],
      ['delta', 'δ'],
      ['Delta', 'Δ'],
      ['lambda', 'λ'],
      ['mu', 'μ'],
      ['sigma', 'σ'],
      ['Sigma', 'Σ'],
      ['phi', 'φ'],
      ['omega', 'ω'],
      ['Omega', 'Ω'],
      ['rho', 'ρ'],
      ['tau', 'τ'],
    ],
  },
];

const { MOD, ALT } = KEY_NAMES;

const keysFor = (submitLabel: string): ShortcutGroup => ({
  title: 'Keys',
  items: [
    [['Tab'], 'Next box'],
    [['Shift', 'Tab'], 'Previous box'],
    [['Space'], 'Out of the box'],
    [[ALT, 'Shift', 'T'], 'Words'],
    [['\\'], 'LaTeX command'],
    [[MOD, 'Z'], 'Undo'],
    [[MOD, 'A'], 'Select all'],
    [['Enter'], submitLabel],
    [['Esc'], 'Cancel'],
  ],
});

/** Columns as wide as the longest entry, as many as the room allows, so one list serves the side and the stack. */
const COLUMNS = {
  typed: 'grid-cols-[repeat(auto-fill,minmax(6rem,1fr))]',
  keys: 'grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]',
} as const;

function Shortcuts({
  group,
  columns,
}: Readonly<{ group: ShortcutGroup; columns: keyof typeof COLUMNS }>) {
  return (
    <section className="flex flex-col gap-1.5">
      <SectionHeading level={3} title={group.title} />
      <div
        className={cn('grid gap-x-3 gap-y-1 text-sm text-foreground-secondary', COLUMNS[columns])}
      >
        {group.items.map(([keys, gives]) => (
          <Shortcut key={String(keys)} keys={typeof keys === 'string' ? [keys] : keys}>
            {gives}
          </Shortcut>
        ))}
      </div>
    </section>
  );
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
export default function MathField({
  value,
  onChange,
  invalid,
  onSubmit,
  submitLabel,
  children,
}: Readonly<MathFieldProps>) {
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
    if (field.current) {
      field.current.inlineShortcuts = { ...field.current.inlineShortcuts, ...OWN_SHORTCUTS };
    }
    field.current?.executeCommand('moveToMathfieldEnd');
    field.current?.focus();

    return () => {
      keyboard.removeEventListener('geometrychange', fit);
      keyboard.hide();
      keyboard.container = document.body;
    };
  }, []);

  return (
    <div className="grid gap-x-6 gap-y-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
      <div className="flex min-w-0 flex-col gap-3">
        {/* createElement, since naming a custom element for JSX takes a global namespace. */}
        {React.createElement(
          'math-field',
          {
            ref: field,
            'aria-label': 'Formula',
            'aria-invalid': invalid,
            'math-virtual-keyboard-policy': 'manual',
            className: cn(
              'block min-h-28 w-full rounded-md border border-input bg-surface px-4 py-3 text-2xl',
              'text-foreground shadow-sm outline-none transition-[box-shadow,border-color]',
              'focus-within:border-ring focus-within:shadow-focus',
              'aria-[invalid=true]:border-destructive',
              'aria-[invalid=true]:focus-within:shadow-focus-invalid',
              '[&::part(menu-toggle)]:hidden [&::part(virtual-keyboard-toggle)]:hidden',
            ),
            // Expanded, so MathLive's own shorthands reach KaTeX as commands it knows.
            onInput: (event: React.SyntheticEvent<MathfieldElement>) =>
              onChange(event.currentTarget.getValue('latex-expanded')),
            // Captured, so it is read before MathLive leaves the LaTeX mode whose Enter is its own.
            onKeyDownCapture: (event: React.KeyboardEvent<MathfieldElement>) => {
              const bare = !(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey);
              if (event.key !== 'Enter' || !bare || event.currentTarget.mode === 'latex') return;
              onSubmit(event.currentTarget.getValue('latex-expanded'));
            },
          },
          initial,
        )}
        {children}
        <div ref={keys} className={KEYBOARD} />
        <Shortcuts group={keysFor(submitLabel)} columns="keys" />
      </div>
      <div className="flex flex-col gap-4">
        {TYPED.map((group) => (
          <Shortcuts key={group.title} group={group} columns="typed" />
        ))}
      </div>
    </div>
  );
}
