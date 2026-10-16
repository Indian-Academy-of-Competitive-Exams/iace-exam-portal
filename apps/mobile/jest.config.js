/** Screen render tests only; the pure-logic tests under test/ stay on node:test. */
module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/screen-test'],
  setupFiles: ['<rootDir>/screen-test/setup.ts'],
  moduleNameMapper: {
    // As metro.config.js: app-kit's copies pair with the web's React, and a second React is a second context.
    '^react$': '<rootDir>/node_modules/react',
    '^react/(.*)$': '<rootDir>/node_modules/react/$1',
    '^@tanstack/react-query$': '<rootDir>/node_modules/@tanstack/react-query',
    // The icon set's react-native build is ES modules only; its CommonJS build draws the same icons.
    '^lucide-react-native/icons/(.*)$':
      '<rootDir>/node_modules/lucide-react-native/dist/cjs/icons/$1.js',
  },
};
