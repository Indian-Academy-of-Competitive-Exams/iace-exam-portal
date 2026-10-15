import { registerHooks } from 'node:module';

/** What Vite bundles and Node cannot load: a stylesheet or an image is an empty module here. Import it first, then the screen with `await import`. */
registerHooks({
  load: (url, context, next) =>
    /\.(css|png|svg)$/.test(url)
      ? { format: 'module', source: 'export default "";', shortCircuit: true }
      : next(url, context),
});
