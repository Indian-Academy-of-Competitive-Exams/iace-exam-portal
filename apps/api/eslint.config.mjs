import config from '@iace/config/eslint';
import boundaries from '@iace/config/eslint-api-boundaries';

export default [
  ...config,
  ...boundaries,
  {
    // The interceptor is the ONE envelope author, and is not a controller, so it is out of scope.
    files: ['**/*.controller.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ReturnStatement ObjectExpression:has(> Property[key.name="success"])',
          message:
            'Return the data or throw AppException. The response interceptor builds { success, data, meta }.',
        },
      ],
    },
  },
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
