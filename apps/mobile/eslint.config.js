import config from '@iace/config/eslint-react';
import noWebUi from '@iace/config/eslint-no-web-ui';

/** Native build output the shared ignores (dist/node_modules/.turbo) don't know about. */
export default [
  { ignores: ['.expo/**', 'android/**', 'ios/**', 'webview/dist/**'] },
  ...config,
  ...noWebUi,
  {
    // Metro and Babel load these as plain CommonJS, never through the app's own bundler.
    files: ['babel.config.js', 'metro.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { module: 'writable', require: 'readonly', __dirname: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
];
