import { describe, it } from 'node:test';
import { RuleTester } from 'eslint';
import { noNarration } from '../eslint-rules/no-narration.js';

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true }, ecmaVersion: 2022 } },
});

const screen = (body) => `function Screen() { ${body} }`;

ruleTester.run('no-narration', noNarration, {
  valid: [
    // A heading that is the plain noun for what sits under it.
    screen('return <h2>Series</h2>;'),
    screen('return <FormSection title="Test series" />;'),

    // In a dialog the description IS the consequence, which is why it is asked for.
    screen(
      'return <ConfirmDialog description="They lose this route to its tests straight away." />;',
    ),

    // A hint carrying a unit the field cannot show, and saying which.
    screen('return <FormField hint="Per wrong answer" // ui-copy-ok: unit\n/>;'),

    // Muted, but a VALUE rather than prose about the screen.
    screen('return <p className="text-sm text-muted-foreground">{value}</p>;'),

    // A Field label that is the term for the value.
    screen('return <Field label="Series" />;'),
    // A Checkbox label is a PROPOSITION, and a Spinner's is a live state — neither names a value.
    screen('return <Checkbox label="Every student must attempt this section" />;'),
    screen('return <Spinner label="Checking your system" />;'),
    screen('return <Stepper label="Building this test" />;'),

    // A failure or a refusal names an EVENT, not a region, so its heading is a sentence.
    screen(
      'return <EmptyState kind={EMPTY_STATE_KINDS.FAILURE} title="Could not load this test" />;',
    ),
    screen(
      'return <EmptyState kind={EMPTY_STATE_KINDS.FAILURE} title="Your tests did not load" hint="It is safe — open it from your performance." />;',
    ),
    screen(
      'return <EmptyState kind={EMPTY_STATE_KINDS.REFUSED} title="This test is not open to you" />;',
    ),
  ],

  invalid: [
    {
      // A pronoun past two words: the heading has crept into a sentence.
      code: screen('return <h2>Series they reach</h2>;'),
      errors: [{ messageId: 'narrativeHeading' }],
    },
    {
      // Leads with a verb, so it is an instruction rather than a name.
      code: screen('return <FormSection title="Grant a series" />;'),
      errors: [{ messageId: 'narrativeHeading' }],
    },
    {
      code: screen('return <FormField hint="the number you signed up with" />;'),
      errors: [{ messageId: 'narrationAttr' }],
    },
    {
      code: screen(
        'return <p className="text-sm text-muted-foreground">This is where you grant access.</p>;',
      ),
      errors: [{ messageId: 'mutedProse' }],
    },
    {
      // Leads with a verb: the label is instructing rather than naming.
      code: screen('return <Field label="Grant a series" />;'),
      errors: [{ messageId: 'narrativeLabel' }],
    },
    {
      code: screen('return <FormField label="Bring them in as" />;'),
      errors: [{ messageId: 'narrativeLabel' }],
    },
    {
      code: screen(
        'return <EmptyState kind={EMPTY_STATE_KINDS.EMPTY} title="This student has not sat a test" />;',
      ),
      errors: [{ messageId: 'narrativeHeading' }],
    },
  ],
});
