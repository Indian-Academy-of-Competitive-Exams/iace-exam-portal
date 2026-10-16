import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { cleanup, render, screen } from '@testing-library/react';
import { ThreadComposer, type ThreadDraft } from '../src/components/ui/thread';
import { TooltipProvider } from '../src/components/ui/tooltip';

afterEach(cleanup);

const PICTURE_ONLY: ThreadDraft = {
  body: '  ',
  images: [{ key: 'k', url: 'blob:x' }],
  editingId: null,
};

const composer = (requireText?: boolean) =>
  render(
    <TooltipProvider>
      <ThreadComposer
        composing={PICTURE_ONLY}
        sending={false}
        onChange={() => undefined}
        onSend={() => undefined}
        placeholder="Write a reply"
        requireText={requireText}
      />
    </TooltipProvider>,
  );

const send = () => screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;

describe('ThreadComposer', () => {
  it('sends a picture alone by default', () => {
    composer();
    assert.equal(send().disabled, false);
  });

  it('holds Send while the text is empty when text is required, picture or not', () => {
    composer(true);
    assert.equal(send().disabled, true);
  });
});
