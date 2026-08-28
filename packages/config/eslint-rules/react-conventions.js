// Two ui-conventions rules that need their own severity. They live here rather
// than in `no-restricted-syntax` because that rule carries ONE severity for its
// whole selector list, and these two warn: a route literal is occasionally a
// real external path, and a first-focus is occasionally legitimate. Both are a
// prompt to look, not a gate — the escape is an eslint-disable naming the why.

/** A route belongs in ROUTES: a typo in a path literal fails silently at runtime. */
export const noHardcodedRoute = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Navigate through the ROUTES constant, never a literal path.' },
    schema: [],
    messages: {
      literalRoute: "'{{path}}' is a route literal. Use ROUTES — a mistyped path fails silently.",
    },
  },

  create(context) {
    const report = (node, value) => {
      if (typeof value === 'string' && value.startsWith('/')) {
        context.report({ node, messageId: 'literalRoute', data: { path: value } });
      }
    };

    return {
      'CallExpression[callee.name="navigate"] > Literal'(node) {
        report(node, node.value);
      },
      'JSXAttribute[name.name="to"] > Literal'(node) {
        report(node, node.value);
      },
    };
  },
};

/** Radix restores focus against the pointer/keyboard heuristic; calling focus() defeats it. */
export const noManualFocus = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Never call .focus() to put focus back — it forces the focus ring on.' },
    schema: [],
    messages: {
      manualFocus:
        'Calling .focus() sets the browser focus-visible flag, so a control dismissed with the MOUSE lights up with a keyboard ring. Radix already restores focus.',
    },
  },

  create(context) {
    return {
      'CallExpression[callee.property.name="focus"]'(node) {
        context.report({ node, messageId: 'manualFocus' });
      },
    };
  },
};

/** The plugin object, for a flat config's `plugins` map. */
export const iaceReactConventionsPlugin = {
  meta: { name: '@iace/config/react-conventions' },
  rules: { 'no-hardcoded-route': noHardcodedRoute, 'no-manual-focus': noManualFocus },
};
