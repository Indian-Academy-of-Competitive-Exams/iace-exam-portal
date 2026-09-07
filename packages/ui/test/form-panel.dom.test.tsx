import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FormPanel, FormSection } from '../src/components/ui/form-panel';
import { Combobox } from '../src/components/ui/combobox';
import { Input } from '../src/components/ui/input';

afterEach(cleanup);

const scrollports = (root: HTMLElement) => root.querySelectorAll('.overflow-y-auto');

describe('FormPanel — tabs are views of one record', () => {
  const panel = (value: string, onValueChange = () => {}) => (
    <FormPanel
      disabled
      footer={<button type="button">Save</button>}
      tabs={{
        value,
        onValueChange,
        items: [
          { value: 'basics', label: 'Basic details', content: <Input aria-label="Name" /> },
          {
            value: 'tests',
            label: 'Tests',
            standalone: true,
            content: <button type="button">Move</button>,
          },
        ],
      }}
    >
      {null}
    </FormPanel>
  );

  /** The failure this prevents: read-only froze the row actions of a list that saves itself. */
  it('leaves a standalone tab live while the form is read-only', () => {
    render(panel('tests'));

    assert.ok(!screen.getByRole('button', { name: 'Move' }).matches(':disabled'), 'still live');
  });

  /** `.disabled` reflects an element's OWN attribute, so the guarantee is `:disabled`. */
  it('still freezes a form tab when the form is read-only', () => {
    render(panel('basics'));

    assert.ok(screen.getByLabelText('Name').matches(':disabled'), 'the field is inert');
  });

  /** A tab that saves itself owns no part of the form, so the form's Save has nothing to do there. */
  it('hides the footer on a standalone tab and shows it on a form tab', () => {
    const { unmount } = render(panel('tests'));
    assert.equal(screen.queryByRole('button', { name: 'Save' }), null);
    unmount();

    render(panel('basics'));
    assert.ok(screen.getByRole('button', { name: 'Save' }));
  });

  /** A form spanning tabs must not lose what was typed on the one you looked away from. */
  it('keeps a form tab mounted while another is open', () => {
    render(panel('tests'));

    assert.ok(screen.getByLabelText('Name'));
  });
});

describe('FormPanel', () => {
  /** A card scrolling inside a frame that scrolls strands content between the two bars. */
  it('has exactly one scrollport', () => {
    const { container } = render(
      <FormPanel header={<h1>New question</h1>} footer={<button type="button">Save</button>}>
        <FormSection title="Where it is filed">fields</FormSection>
      </FormPanel>,
    );

    assert.equal(scrollports(container).length, 1);
  });

  /** Measured: an sr-only legend escaped a static scroller and made the document 42px taller. */
  it('makes its scrollport a containing block', () => {
    const { container } = render(
      <FormPanel>
        <FormSection title="A">fields</FormSection>
      </FormPanel>,
    );

    assert.match(scrollports(container)[0]?.className ?? '', /\brelative\b/);
  });

  /** Save must not sit at the end of a scroll nobody reached, so it lives outside the scroller. */
  it('keeps the footer out of the scrolling body', () => {
    const { container } = render(
      <FormPanel footer={<button type="button">Save</button>}>
        <FormSection title="Where it is filed">fields</FormSection>
      </FormPanel>,
    );

    const scroller = scrollports(container)[0];
    assert.ok(scroller);
    assert.equal(scroller?.contains(screen.getByRole('button', { name: 'Save' })), false);
  });

  /** Same for the header — it is pinned above the card, not scrolled with the fields. */
  it('keeps the header out of the scrolling body', () => {
    const { container } = render(
      <FormPanel header={<h1>New question</h1>}>
        <FormSection title="Where it is filed">fields</FormSection>
      </FormPanel>,
    );

    const scroller = scrollports(container)[0];
    assert.equal(scroller?.contains(screen.getByRole('heading', { name: 'New question' })), false);
  });

  /** The shell stops scrolling the page only when it :has() this. */
  it('marks itself as the page frame', () => {
    const { container } = render(
      <FormPanel>
        <FormSection title="A">fields</FormSection>
      </FormPanel>,
    );

    assert.ok(container.querySelector('[data-page-frame]'));
  });

  it('submits as a real form, so a footer submit button works', () => {
    const onSubmit = mock.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <FormPanel onSubmit={onSubmit} footer={<button type="submit">Save</button>}>
        <FormSection title="A">fields</FormSection>
      </FormPanel>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    assert.equal(onSubmit.mock.callCount(), 1);
  });

  /** A read-only panel has nothing to pin, and an empty bordered strip is furniture. */
  it('draws no footer when there are no actions', () => {
    const { container } = render(
      <FormPanel>
        <FormSection title="A">fields</FormSection>
      </FormPanel>,
    );

    assert.equal(container.querySelectorAll('.border-t').length, 0);
  });

  /** Headings and spacing group the body; a border between them is the card rule again. */
  it('gives a section a heading and no border', () => {
    render(
      <FormPanel>
        <FormSection title="Where it is filed" meta="2 subjects">
          fields
        </FormSection>
      </FormPanel>,
    );

    const heading = screen.getByRole('heading', { name: 'Where it is filed' });
    assert.equal(heading.closest('section')?.className.includes('border'), false);
    assert.ok(screen.getByText('2 subjects'));
  });
});

describe('a read-only FormPanel', () => {
  /** `.disabled` reflects an element's OWN attribute, so the guarantee is `:disabled`. */
  it('makes every control inside inert, including the button a Combobox renders', () => {
    render(
      <FormPanel disabled>
        <Input aria-label="Full name" />
        <Combobox aria-label="Gender" value="" onChange={() => {}} items={[]} />
      </FormPanel>,
    );

    assert.ok(screen.getByLabelText('Full name').matches(':disabled'), 'the input is inert');
    assert.ok(
      screen.getByLabelText('Gender').matches(':disabled'),
      'the combobox trigger is inert',
    );
  });

  /** The way out of read-only lives in the footer, so disabling it would strand the reader. */
  it('leaves the footer live, so Edit is still reachable', () => {
    render(
      <FormPanel disabled footer={<button type="button">Edit details</button>}>
        <Input aria-label="Full name" />
      </FormPanel>,
    );

    assert.ok(!screen.getByRole('button', { name: 'Edit details' }).matches(':disabled'));
  });

  /** A student's granted series is not the profile being edited, so Edit must not reach it. */
  it('leaves an `after` section live while the fields are inert', () => {
    render(
      <FormPanel disabled after={<Input aria-label="Grant a series" />}>
        <Input aria-label="Full name" />
      </FormPanel>,
    );

    assert.ok(screen.getByLabelText('Full name').matches(':disabled'), 'the field is inert');
    assert.ok(
      !screen.getByLabelText('Grant a series').matches(':disabled'),
      'the section outside the fieldset is not',
    );
  });

  it('leaves the same controls live when it is not disabled', () => {
    render(
      <FormPanel>
        <Input aria-label="Full name" />
        <Combobox aria-label="Gender" value="" onChange={() => {}} items={[]} />
      </FormPanel>,
    );

    assert.ok(!screen.getByLabelText('Full name').matches(':disabled'));
    assert.ok(!screen.getByLabelText('Gender').matches(':disabled'));
  });
});
