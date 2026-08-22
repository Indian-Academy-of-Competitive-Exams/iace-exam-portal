import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RichText } from '../src/components/ui/rich-text';
import { FormPanel } from '../src/components/ui/form-panel';
import { TooltipProvider } from '../src/components/ui/tooltip';

afterEach(cleanup);

const noop = () => {};

/** The toolbar's buttons are icon-only, so they carry Tooltips — which AppProviders supplies. */
const show = (ui: React.ReactNode) => render(<TooltipProvider>{ui}</TooltipProvider>);

describe('RichText', () => {
  it('offers the marks an exam question actually needs', () => {
    show(<RichText value="" onChange={noop} />);

    for (const label of ['Bold', 'Italic', 'Underline', 'Superscript', 'Subscript', 'Equation']) {
      assert.ok(screen.getByLabelText(label), `${label} should be on the toolbar`);
    }
  });

  /** A one-line MCQ option cannot hold a list, so offering one only breaks the row. */
  it('drops the list buttons on a single-line field, and keeps the rest', () => {
    show(<RichText value="" onChange={noop} singleLine />);

    assert.equal(screen.queryByLabelText('Bullet list'), null);
    assert.ok(screen.getByLabelText('Superscript'));
    assert.ok(screen.getByLabelText('Equation'));
  });

  /** A row of inert buttons says nothing the grey field does not already say. */
  it('shows no toolbar at all when it is read-only', () => {
    show(<RichText value="<p>x</p>" onChange={noop} disabled />);

    assert.equal(screen.queryByLabelText('Bold'), null);
    assert.equal(screen.queryByLabelText('Equation'), null);
  });

  /** The whole point of the fieldset context: a contenteditable is not a form control. */
  it('goes read-only from the FormPanel around it, with no prop passed', () => {
    show(
      <FormPanel disabled>
        <RichText value="<p>x</p>" onChange={noop} />
      </FormPanel>,
    );

    assert.equal(screen.queryByLabelText('Bold'), null);
  });

  it('tags the content with its language, which is what :lang(te) matches on', () => {
    const { container } = show(<RichText value="" onChange={noop} lang="te" />);

    assert.ok(container.querySelector('[lang="te"]'), 'the editable element carries lang');
  });

  describe('the equation dialog', () => {
    it('opens from the toolbar and previews what is typed', () => {
      show(<RichText value="" onChange={noop} />);
      fireEvent.click(screen.getByLabelText('Equation'));

      const input = screen.getByLabelText('LaTeX') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '\\frac{a}{b}' } });

      assert.match(screen.getByLabelText('Preview').innerHTML, /katex/);
    });

    /** Storing an empty formula would leave a node that renders as nothing and cannot be clicked. */
    it('will not insert an empty formula', () => {
      show(<RichText value="" onChange={noop} />);
      fireEvent.click(screen.getByLabelText('Equation'));

      assert.ok((screen.getByRole('button', { name: 'Insert' }) as HTMLButtonElement).disabled);
    });

    it('writes the formula into the content as latex, not as rendered markup', () => {
      let html = '';
      show(<RichText value="" onChange={(next) => (html = next)} />);

      fireEvent.click(screen.getByLabelText('Equation'));
      fireEvent.change(screen.getByLabelText('LaTeX'), { target: { value: 'x^2' } });
      fireEvent.click(screen.getByRole('button', { name: 'Insert' }));

      assert.match(html, /data-latex="x\^2"/);
    });
  });
});
