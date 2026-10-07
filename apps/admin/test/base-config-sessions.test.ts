import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  sectionsAfterSessionRemoved,
  sectionsInSession,
} from '../src/features/catalog/base-config-sessions';

const inSession = (name: string, moduleOrder: string) => ({ name, moduleOrder });

describe('the sections of a session paper after a session is removed', () => {
  /** The failure this prevents: removing B sliding the C section into whatever now sits at C's old position. */
  it('keeps a later section in its own session, and moves the removed one to the first', () => {
    const sections = [
      inSession('Reasoning', '0'),
      inSession('Maths', '1'),
      inSession('English', '2'),
    ];

    assert.deepEqual(sectionsAfterSessionRemoved(sections, 1), [
      inSession('Reasoning', '0'),
      inSession('Maths', ''),
      inSession('English', '1'),
    ]);
  });

  it('leaves no section pointing past the end when the last session goes', () => {
    const sections = [inSession('Reasoning', ''), inSession('English', '2')];

    assert.deepEqual(sectionsAfterSessionRemoved(sections, 2), [
      inSession('Reasoning', ''),
      inSession('English', ''),
    ]);
  });

  it('leaves a section of an earlier session exactly as it was', () => {
    const sections = [inSession('Reasoning', ''), inSession('Maths', '1')];

    assert.deepEqual(sectionsAfterSessionRemoved(sections, 2), sections);
  });
});

describe('the sections a session holds', () => {
  it('counts an unnamed section in the first session, which is where the server puts it', () => {
    const sections = [
      inSession('Reasoning', ''),
      inSession('Maths', '0'),
      inSession('English', '1'),
    ];

    assert.deepEqual(sectionsInSession(sections, 0), [sections[0], sections[1]]);
    assert.deepEqual(sectionsInSession(sections, 1), [sections[2]]);
  });
});
