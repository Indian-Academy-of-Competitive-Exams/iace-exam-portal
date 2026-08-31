import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { cleanup, render, waitFor } from '@testing-library/react';
import { useFullscreen, type FullscreenHandle } from '../browser/use-fullscreen';

afterEach(cleanup);

function Probe({ onRender }: Readonly<{ onRender: (handle: FullscreenHandle) => void }>) {
  onRender(useFullscreen());
  return null;
}

/** Returns a reader for the LATEST handle: `exits` is per-instance, so remounting would reset it. */
function mounted(): () => FullscreenHandle {
  let latest: FullscreenHandle | null = null;
  render(
    <Probe
      onRender={(next) => {
        latest = next;
      }}
    />,
  );
  return () => {
    assert.ok(latest, 'the hook rendered');
    return latest;
  };
}

/** Restores whatever the document carried, so one test cannot leak an API into the next. */
function withDocument(patch: Record<string, unknown>, run: () => Promise<void>): Promise<void> {
  const before = Object.fromEntries(
    Object.keys(patch).map((key) => [key, (document as unknown as Record<string, unknown>)[key]]),
  );
  Object.assign(document, patch);
  return run().finally(() => Object.assign(document, before));
}

describe('useFullscreen', () => {
  it('hands the screen back through the standard API', async () => {
    let released = 0;
    await withDocument({ exitFullscreen: () => ((released += 1), Promise.resolve()) }, async () => {
      await mounted()().exit();
      assert.equal(released, 1);
    });
  });

  it('falls back to the prefixed name, which is what an iPad answers to', async () => {
    let released = 0;
    await withDocument(
      {
        exitFullscreen: undefined,
        webkitExitFullscreen: () => ((released += 1), Promise.resolve()),
      },
      async () => {
        await mounted()().exit();
        assert.equal(released, 1);
      },
    );
  });

  it('swallows a refusal rather than throwing at the screen that asked', async () => {
    await withDocument({ exitFullscreen: () => Promise.reject(new Error('denied')) }, async () => {
      await mounted()().exit();
    });
  });

  it('does nothing where the browser offers no way out', async () => {
    await withDocument({ exitFullscreen: undefined, webkitExitFullscreen: undefined }, async () => {
      await mounted()().exit();
    });
  });

  it('counts a departure from fullscreen, which is what the exam nags about', async () => {
    const handle = mounted();
    assert.equal(handle().exits, 0);

    document.dispatchEvent(new Event('fullscreenchange'));

    await waitFor(() => assert.equal(handle().exits, 1));
  });
});
