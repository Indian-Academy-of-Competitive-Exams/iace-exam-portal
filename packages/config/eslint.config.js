// Shared flat ESLint config for TypeScript packages (Node / library).
// Apps extend this in their own eslint.config.js.
import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import sonarjs from 'eslint-plugin-sonarjs';

export default defineConfig([
  { ignores: ['dist/**', 'node_modules/**', '.turbo/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    plugins: { sonarjs },
    rules: {
      // Locked, not inherited: recommended only WARNS on `any`, and a warning gets scrolled past.
      '@typescript-eslint/no-explicit-any': 'error',
      // An error now the backlog is cleared: as a warning it grew back to 250 unread.
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // The same limit the Sonar gate holds (S3776), checked on every commit instead of on request.
      'sonarjs/cognitive-complexity': ['error', 15],
    },
  },
  prettier,
]);
