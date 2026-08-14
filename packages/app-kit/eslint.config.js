import config from '@iace/config/eslint-react';
import noDom from '@iace/config/eslint-no-dom';

// The React rules, then the portability gate: this package is the tier mobile
// reuses verbatim, so `src` may not touch the DOM (docs/03 §3).
export default [...config, ...noDom];
