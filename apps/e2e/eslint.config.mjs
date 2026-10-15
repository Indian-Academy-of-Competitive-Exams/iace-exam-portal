import config from '@iace/config/eslint';

export default [...config, { ignores: ['test-results/**', 'playwright-report/**'] }];
