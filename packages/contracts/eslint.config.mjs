import config from '@iace/config/eslint';
import noDom from '@iace/config/eslint-no-dom';

// Shapes and the typed client — the wire format for web, mobile and any future
// service. Nothing in here may assume a browser (docs/03 §3).
export default [...config, ...noDom];
