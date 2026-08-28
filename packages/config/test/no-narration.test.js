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
  ],
});
