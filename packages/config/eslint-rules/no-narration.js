// "The UI does not narrate" (the ui-conventions skill), made mechanical. In the
// SPAs three shapes are flagged: a description/subtitle/hint attribute, a muted
// explanatory <p>, and a heading that is a phrase rather than a plain noun. It is
// deliberately conservative (misses before false-alarms) because the real fix is
// editorial and a person makes it; the one escape is an inline
// `// ui-copy-ok: <unit|format|limit|rule|consequence>` naming what the string earns.

/** description belongs to a dialog (there it IS the consequence); hint/subtitle never do. */
const NARRATION_ATTRS = new Set(['description', 'subtitle', 'hint']);
const DIALOG_ELEMENTS = new Set([
  'ConfirmDialog',
  'FormDialog',
  'Dialog',
  'AlertDialog',
  'DialogHeader',
]);

/** A heading string is narrative if it leads with a verb, or (past two words) carries a pronoun/modal. */
const IMPERATIVE_LEAD = new Set([
  'grant',
  'add',
  'create',
  'manage',
  'edit',
  'remove',
  'configure',
  'assign',
  'choose',
  'pick',
  'enable',
  'disable',
]);
const NARRATION_WORDS = new Set([
  'they',
  'them',
  'their',
  'you',
  'your',
  'yours',
  'we',
  'us',
  'our',
  'it',
  'its',
  'this',
  'these',
  'those',
  'that',
  'which',
  'who',
  'whom',
  'can',
  'cannot',
  'will',
  'reach',
  'reaches',
  'sit',
  'sits',
]);
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4']);
const HEADING_ATTRS = new Set(['title', 'heading']);

/** A Field's label NAMES the value. A Checkbox label is a proposition and a Spinner's is a state. */
const FIELD_ELEMENTS = new Set(['Field', 'FormField']);

/** A failure is an event, not a region: "Could not load this test" IS its name. */
const namesAFailure = (opening) =>
  (opening?.attributes ?? []).some(
    (a) =>
      a.type === 'JSXAttribute' &&
      a.name?.name === 'kind' &&
      a.value?.type === 'JSXExpressionContainer' &&
      a.value.expression?.type === 'MemberExpression' &&
      a.value.expression.property?.name === 'FAILURE',
  );

/** The two attributes whose exemption is carried by the element they sit on. */
const carriesItsOwnExemption = (name, opening) =>
  name === 'description'
    ? DIALOG_ELEMENTS.has(elementName(opening) ?? '')
    : name === 'hint' && namesAFailure(opening);

/** Which narration a string attribute would be, or null where it is not one at all. */
const narrationOf = (name, opening) => {
  if (name === 'label') return FIELD_ELEMENTS.has(elementName(opening)) ? 'narrativeLabel' : null;
  return HEADING_ATTRS.has(name) && !namesAFailure(opening) ? 'narrativeHeading' : null;
};

const word = (w) => w.toLowerCase().replace(/[^a-z]/g, '');

function looksNarrative(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  if (IMPERATIVE_LEAD.has(word(words[0]))) return true;
  return words.length > 2 && words.some((w) => NARRATION_WORDS.has(word(w)));
}

const elementName = (opening) =>
  opening?.name?.type === 'JSXIdentifier' ? opening.name.name : null;

const staticText = (node) => {
  const parts = (node.children ?? [])
    .filter((c) => c.type === 'JSXText')
    .map((c) => c.value.trim())
    .filter(Boolean);
  const hasExpr = (node.children ?? []).some((c) => c.type === 'JSXExpressionContainer');
  return hasExpr ? '' : parts.join(' ');
};

const literal = (attr) =>
  attr.value?.type === 'Literal' && typeof attr.value.value === 'string' ? attr.value.value : null;

/** @type {import('eslint').Rule.RuleModule} */
export const noNarration = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'The UI names and shows; it does not narrate. Headings are nouns; helper text earns its line.',
    },
    schema: [],
    messages: {
      narrationAttr:
        '`{{attr}}=` narrates. Delete it, or justify with `// ui-copy-ok: <unit|format|limit|rule|consequence>` — the label usually says it better.',
      mutedProse:
        'A muted <p> reads as content and gets skipped. Put it in an Alert, fold it into a label, or delete it; justify with `// ui-copy-ok:` only if it truly earns its line.',
      narrativeLabel:
        'A field label names the value; it does not instruct. “{{text}}” reads as a sentence — use the term the reader already calls the thing.',
      narrativeHeading:
        'A heading is the plain noun for the region — “{{noun}}”, not “{{text}}”. Drop the narration.',
    },
  },

  create(context) {
    const sc = context.sourceCode ?? context.getSourceCode();
    const okLines = new Set();
    for (const c of sc.getAllComments()) {
      if (/\bui-copy-ok\b/.test(c.value)) okLines.add(c.loc.start.line);
    }
    const justified = (node) =>
      okLines.has(node.loc.start.line) || okLines.has(node.loc.start.line - 1);
    const report = (node, messageId, data) => {
      if (!justified(node)) context.report({ node, messageId, data });
    };

    return {
      JSXAttribute(node) {
        const name = node.name?.name;
        if (!name) return;

        if (NARRATION_ATTRS.has(name)) {
          if (!carriesItsOwnExemption(name, node.parent))
            report(node, 'narrationAttr', { attr: name });
          return;
        }

        const messageId = narrationOf(name, node.parent);
        const text = messageId ? literal(node) : null;
        if (text && looksNarrative(text)) {
          report(node, messageId, { text, noun: text.trim().split(/\s+/).at(-1) });
        }
      },

      JSXElement(node) {
        const opening = node.openingElement;
        const tag = elementName(opening);
        if (!tag) return;

        if (HEADING_TAGS.has(tag)) {
          const text = staticText(node);
          if (text && looksNarrative(text)) {
            report(opening, 'narrativeHeading', { text, noun: text.split(/\s+/).at(-1) });
          }
          return;
        }
        if (tag === 'p') {
          const cls = opening.attributes.find(
            (a) => a.type === 'JSXAttribute' && a.name?.name === 'className',
          );
          const value = cls ? literal(cls) : null;
          if (value?.includes('text-muted-foreground') && staticText(node)) {
            report(opening, 'mutedProse');
          }
        }
      },
    };
  },
};

/** The plugin object, for a flat config's `plugins` map. */
export const iaceNarrationPlugin = {
  meta: { name: '@iace/config/copy' },
  rules: { 'no-narration': noNarration },
};
