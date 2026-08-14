import config from '@iace/config/eslint';
import boundaries from '@iace/config/eslint-api-boundaries';

export default [
  ...config,
  ...boundaries,
  {
    files: ['src/**/*.ts'],
    rules: {
      // MUST stay off for NestJS. With `emitDecoratorMetadata`, TypeScript
      // emits constructor parameter types as design:paramtypes VALUES — that
      // metadata is how the DI container resolves a provider. Rewriting an
      // injected class to `import type` erases it and breaks injection at
      // runtime, with no compile-time warning.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
];
