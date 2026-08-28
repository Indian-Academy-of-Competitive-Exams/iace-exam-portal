// Shared flat ESLint config for the React SPAs.
import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import { confirmDestructive } from './eslint-rules/confirm-destructive.js';
import { noNarration } from './eslint-rules/no-narration.js';
import { noHardcodedRoute, noManualFocus } from './eslint-rules/react-conventions.js';

export default defineConfig([
  { ignores: ['dist/**', 'node_modules/**', '.turbo/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      '@iace': {
        meta: { name: '@iace' },
        rules: {
          'confirm-destructive': confirmDestructive,
          'no-narration': noNarration,
          'no-hardcoded-route': noHardcodedRoute,
          'no-manual-focus': noManualFocus,
        },
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@iace/confirm-destructive': 'error',
      '@iace/no-narration': 'error',
      // Warn, not error: a path literal is occasionally external, a first-focus occasionally real.
      '@iace/no-hardcoded-route': 'warn',
      '@iace/no-manual-focus': 'warn',
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Use the typed client from @iace/contracts, never raw HTTP.' },
      ],
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'axios', message: 'Use the typed client from @iace/contracts.' }] },
      ],
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Locked, not inherited: recommended only WARNS on `any`, and a warning gets scrolled past.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // Design-system rules a type cannot state, because these are intrinsic elements.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXOpeningElement[name.name="Loader2"]',
          message:
            'Content waits use Skeleton; actions use Spinner or LoadingState. Never hand-roll a spinner.',
        },
        {
          selector: String.raw`JSXAttribute[name.name="className"][value.value=/\banimate-spin\b/]`,
          message:
            'Content waits use Skeleton; actions use Spinner or LoadingState. Never hand-roll a spinner.',
        },
        {
          selector: 'JSXOpeningElement[name.name="select"]',
          message: 'Use Combobox. The OS draws a native <select> list, so it matches nothing else.',
        },
        {
          selector:
            'JSXOpeningElement[name.name=/^[a-z]/]:has(JSXAttribute[name.name="type"][value.value=/^(date|datetime-local|time|month|week)$/])',
          message:
            'Use DatePicker. Every browser draws its own calendar, and a phone draws a fourth.',
        },
        {
          // The intrinsic ban above is by-passable as <Input type="date">, which renders the same thing.
          selector:
            'JSXOpeningElement[name.name="Input"]:has(JSXAttribute[name.name="type"][value.value=/^(date|datetime-local|time|month|week)$/])',
          message:
            'Use DatePicker or DateTimePicker. Passing the type through Input draws the browser calendar anyway.',
        },
        {
          selector: 'JSXOpeningElement[name.name=/^[a-z]/]:has(JSXAttribute[name.name="title"])',
          message: 'Use Tooltip. Keyboard focus never fires the native title, and it is undrawn.',
        },
        {
          selector: String.raw`JSXAttribute[name.name="className"][value.value=/\bring-2\b/]`,
          message: 'Use focus-visible:shadow-focus, which reads the --focus-ring token.',
        },
        {
          selector: String.raw`JSXAttribute[name.name="className"][value.value=/#[0-9a-fA-F]{3,8}\b/]`,
          message: 'Take the colour from a packages/ui token, never a raw hex.',
        },
        {
          // Unmapped, so tracking-wider draws 0.05em — narrower than our 0.06em wide.
          selector: String.raw`JSXAttribute[name.name="className"][value.value=/\btracking-(tighter|wider|widest)\b/]`,
          message: 'The tracking scale is tight, snug, normal, wide. Anything else is off-system.',
        },
        {
          selector: String.raw`JSXAttribute[name.name="className"][value.value=/\btext-(4xl|5xl|6xl|7xl|8xl|9xl)\b/]`,
          message: 'The type scale ends at text-3xl. A bigger step needs a token first.',
        },
      ],
    },
  },
  prettier,
]);
