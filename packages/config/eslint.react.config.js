// Shared flat ESLint config for the React SPAs.
import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

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
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
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
