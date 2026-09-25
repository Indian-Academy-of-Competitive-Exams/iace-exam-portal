import config from '@iace/config/eslint-react';
import noDom from '@iace/config/eslint-no-dom';

// React rules, then the portability gate: this tier is reused verbatim by mobile, so `src` may not touch the DOM (docs/03 §3).
export default [...config, ...noDom];
