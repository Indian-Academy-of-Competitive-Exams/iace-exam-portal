import { describe, it } from 'node:test';
import { RuleTester } from 'eslint';
import { noHardcodedRoute, noManualFocus } from '../eslint-rules/react-conventions.js';

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true }, ecmaVersion: 2022 } },
});

const screen = (body) => `function Screen() { ${body} }`;

ruleTester.run('no-hardcoded-route', noHardcodedRoute, {
  valid: [
    screen('navigate(ROUTES.STUDENTS); return <p />;'),
    screen('return <Link to={ROUTES.STUDENTS} />;'),
    // A template literal carrying ROUTES plus a query string is the constant, used.
    screen('return <Link to={`${ROUTES.STUDENTS}?branchId=${id}`} />;'),
    // Not a route: a relative anchor and an external URL both start elsewhere.
    screen('return <a href="https://iace.co.in" />;'),
    screen('navigate(-1); return <p />;'),
  ],

  invalid: [
    {
      code: screen('navigate("/students"); return <p />;'),
      errors: [{ messageId: 'literalRoute' }],
    },
    { code: screen('return <Link to="/students" />;'), errors: [{ messageId: 'literalRoute' }] },
  ],
});

ruleTester.run('no-manual-focus', noManualFocus, {
  valid: [screen('ref.current.select(); return <p />;'), screen('element.blur(); return <p />;')],

  invalid: [
    { code: screen('ref.current.focus(); return <p />;'), errors: [{ messageId: 'manualFocus' }] },
    {
      code: screen('document.getElementById("x").focus(); return <p />;'),
      errors: [{ messageId: 'manualFocus' }],
    },
  ],
});
