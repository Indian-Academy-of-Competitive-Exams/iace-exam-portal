import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RichText } from '../src/components/ui/rich-text';
import { FormPanel } from '../src/components/ui/form-panel';
import { TooltipProvider } from '../src/components/ui/tooltip';
import { imageFilesIn, insertUploaded } from '../src/components/ui/rich-text-image';
import { Toaster, toast } from '../src/components/ui/toast';

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

describe('images', () => {
  const upload = () => Promise.resolve({ key: 'questions/images/a.png', url: 'https://s3/a' });

  /** Without an uploader the field takes no images, so nothing offers one. */
  it('shows no image button when the field cannot take one', () => {
    show(<RichText value="" onChange={noop} />);

    assert.equal(screen.queryByLabelText('Image'), null);
  });

  it('offers one when an uploader is given', () => {
    show(<RichText value="" onChange={noop} onUploadImage={upload} />);

    assert.ok(screen.getByLabelText('Image'));
  });

  /** The decision that stops the base64 trap; whether ProseMirror routes the event is its own. */
  it('sees an image on the clipboard, and nothing on a text one', () => {
    const file = new File(['bytes'], 'a.png', { type: 'image/png' });
    const asImage = {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
    } as unknown as DataTransfer;
    const asText = {
      items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }],
    } as unknown as DataTransfer;

    assert.deepEqual(imageFilesIn(asImage), [file]);
    assert.deepEqual(imageFilesIn(asText), []);
    assert.deepEqual(imageFilesIn(null), []);
  });
});

describe('tables', () => {
  it('offers a table on a field that holds blocks', () => {
    show(<RichText value="" onChange={noop} />);

    assert.ok(screen.getByLabelText('Table'));
  });

  /** A table cannot live in one line, so an MCQ option is not offered one. */
  it('offers none on a single-line field', () => {
    show(<RichText value="" onChange={noop} singleLine />);

    assert.equal(screen.queryByLabelText('Table'), null);
  });

  it('inserts a real table, with a header row', async () => {
    let html = '';
    show(<RichText value="" onChange={(next) => (html = next)} />);

    // Radix opens a menu on pointerDown, not click.
    fireEvent.pointerDown(screen.getByLabelText('Table'), { button: 0 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Insert a table' }));

    assert.match(html, /<table/);
    assert.match(html, /<th/, 'the first row is headers, which is what a data question needs');
  });

  /** Out of a table those actions apply to nothing, and the rule is to leave them out. */
  it('offers only Insert while the caret is outside a table', async () => {
    show(<RichText value="<p>plain</p>" onChange={noop} />);
    fireEvent.pointerDown(screen.getByLabelText('Table'), { button: 0 });

    assert.ok(await screen.findByRole('menuitem', { name: 'Insert a table' }));
    assert.equal(screen.queryByRole('menuitem', { name: 'Delete table' }), null);
    assert.equal(screen.queryByRole('menuitem', { name: 'Row above' }), null);
  });
});

describe('the equation dialog refuses what will not render', () => {
  const open = () => {
    show(<RichText value="" onChange={noop} />);
    fireEvent.click(screen.getByLabelText('Equation'));
    return screen.getByLabelText('LaTeX');
  };

  it('lets a formula that renders through', () => {
    fireEvent.change(open(), { target: { value: '\\frac{a}{b}' } });

    assert.ok(!(screen.getByRole('button', { name: 'Insert' }) as HTMLButtonElement).disabled);
  });

  /** Stored, this reaches a candidate mid-test as red error text — the author is where it stops. */
  it('blocks a half-typed one, and says what is wrong', () => {
    fireEvent.change(open(), { target: { value: '\\frac{a}' } });

    assert.ok((screen.getByRole('button', { name: 'Insert' }) as HTMLButtonElement).disabled);
    assert.match(screen.getByRole('alert').textContent ?? '', /Unexpected end of input/);
  });

  it('blocks a command that does not exist, which the preview alone would have drawn', () => {
    fireEvent.change(open(), { target: { value: '\\notacommand{x}' } });

    assert.ok((screen.getByRole('button', { name: 'Insert' }) as HTMLButtonElement).disabled);
  });

  /** Typing is not failing: an empty box is not yet a broken formula. */
  it('says nothing about an empty box', () => {
    open();

    assert.equal(screen.queryByRole('alert'), null);
  });
});

describe('an image the field will not take', () => {
  const limits = { accept: ['image/png'], maxBytes: 2 * 1024 * 1024 };
  const never = () => Promise.reject(new Error('should not have been uploaded'));
  const file = (size: number, type = 'image/png') =>
    new File([new Uint8Array(size)], 'a.png', { type });
  const stubEditor = {
    chain: () => ({ focus: () => ({ setImage: () => ({ run: () => true }) }) }),
  } as never;

  afterEach(() => toast.clear());

  /** It reached the server, the server refused it, and nothing told anybody. */
  it('says so when the upload is refused, rather than failing silently', async () => {
    render(<Toaster />);
    insertUploaded(stubEditor, file(10), () =>
      Promise.reject(new Error('That image is larger than 2MB.')),
    );

    assert.ok(await screen.findByText(/larger than 2MB/));
  });

  /** Refused here, so ten megabytes are never put on the wire to be refused there. */
  it('refuses an oversized file without uploading it at all', async () => {
    render(<Toaster />);
    insertUploaded(stubEditor, file(3 * 1024 * 1024), never, limits);

    assert.ok(await screen.findByText(/larger than 2MB/));
  });

  it('refuses a type the server would not take, and names what it would', async () => {
    render(<Toaster />);
    insertUploaded(stubEditor, file(10, 'image/svg+xml'), never, limits);

    assert.ok(await screen.findByText(/not accepted/));
  });

  it('lets an acceptable file through to the uploader', () => {
    let asked = false;
    insertUploaded(
      stubEditor,
      file(10),
      () => {
        asked = true;
        return Promise.resolve({ key: 'k', url: 'u' });
      },
      limits,
    );

    assert.ok(asked, 'a file inside the limits must reach the uploader');
  });
});

describe('the toolbar actually changes the content', () => {
  /** The buttons existing was asserted; that they did anything was not, and one of them did not. */
  const write = () => {
    let html = '';
    show(<RichText value="<p>hello</p>" onChange={(next) => (html = next)} />);
    return () => html;
  };

  it('makes a bullet list', () => {
    const html = write();
    fireEvent.click(screen.getByLabelText('Bullet list'));

    assert.match(html(), /<ul>/);
    assert.match(html(), /<li>/);
  });

  it('makes a numbered list', () => {
    const html = write();
    fireEvent.click(screen.getByLabelText('Numbered list'));

    assert.match(html(), /<ol>/);
  });

  it('turns a list back off', () => {
    const html = write();
    fireEvent.click(screen.getByLabelText('Bullet list'));
    fireEvent.click(screen.getByLabelText('Bullet list'));

    assert.doesNotMatch(html(), /<ul>/);
  });

  /** A list a reader cannot see is the bug this suite missed, so the style is asserted too. */
  it('gives the content the class the list styles hang off', () => {
    const { container } = show(<RichText value="<p>x</p>" onChange={noop} />);

    assert.ok(
      container.querySelector('.rich-content'),
      'components.css styles .rich-content lists',
    );
  });
});

describe('content arriving from outside', () => {
  /** The bug: loading a question reported itself as a keystroke, and the caller wrote back. */
  it('does not report a change when the value is pushed in', () => {
    const changes: string[] = [];
    const view = show(<RichText value="" onChange={(next) => changes.push(next)} disabled />);

    view.rerender(
      <TooltipProvider>
        <RichText
          value="<p>What is 20% of 150?</p>"
          onChange={(next) => changes.push(next)}
          disabled
        />
      </TooltipProvider>,
    );

    assert.deepEqual(changes, [], 'syncing in must not look like the user typing');
  });

  /** The other half: it has to actually arrive, or the field is silently blank. */
  it('shows what was pushed in', () => {
    const view = show(<RichText value="" onChange={noop} disabled />);

    view.rerender(
      <TooltipProvider>
        <RichText value="<p>What is 20% of 150?</p>" onChange={noop} disabled />
      </TooltipProvider>,
    );

    const editable = document.querySelector('[contenteditable]');
    assert.match(editable?.textContent ?? '', /20% of 150/);
  });

  /** A question written before the editor existed is plain text, and must not be parsed as html. */
  it('takes plain text without losing it', () => {
    const view = show(<RichText value="" onChange={noop} disabled />);

    view.rerender(
      <TooltipProvider>
        <RichText value="Is a < b when a = 2?" onChange={noop} disabled />
      </TooltipProvider>,
    );

    assert.match(document.querySelector('[contenteditable]')?.textContent ?? '', /a < b/);
  });
});
