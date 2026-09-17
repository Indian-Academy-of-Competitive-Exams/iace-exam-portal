import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FOCUS_EVENTS,
  FOCUS_START,
  focusAfter,
  isOnPaper,
  leavesPaper,
} from '../src/components/exam/focus-guard';

test('a sitting starts on the paper with zero exits', () => {
  assert.equal(isOnPaper(FOCUS_START), true);
  assert.equal(FOCUS_START.exits, 0);
  assert.equal(FOCUS_START.acknowledged, 0);
});

test('backgrounding counts one exit and leaves the paper', () => {
  const after = focusAfter(FOCUS_START, FOCUS_EVENTS.BACKGROUND);
  assert.equal(after.exits, 1);
  assert.equal(after.acknowledged, 0);
  assert.equal(isOnPaper(after), false);
});

test('returning to the app, or passing through inactive, does not leave the paper', () => {
  assert.equal(leavesPaper('background'), true, 'backgrounding leaves the paper');
  assert.equal(leavesPaper('active'), false, 'returning to the app does not leave the paper');
  assert.equal(leavesPaper('inactive'), false, 'iOS inactive does not leave the paper');
});

test('acknowledging puts them back on the paper and does not erase the exit count', () => {
  const backgrounded = focusAfter(FOCUS_START, FOCUS_EVENTS.BACKGROUND);
  const acknowledged = focusAfter(backgrounded, FOCUS_EVENTS.ACKNOWLEDGE);
  assert.equal(acknowledged.exits, 1);
  assert.equal(acknowledged.acknowledged, 1);
  assert.equal(isOnPaper(acknowledged), true);
});

test('after acknowledging, a second backgrounding raises exits to 2 and leaves the paper again', () => {
  let state = FOCUS_START;
  state = focusAfter(state, FOCUS_EVENTS.BACKGROUND);
  state = focusAfter(state, FOCUS_EVENTS.ACKNOWLEDGE);
  state = focusAfter(state, FOCUS_EVENTS.BACKGROUND);
  assert.equal(state.exits, 2);
  assert.equal(state.acknowledged, 1);
  assert.equal(isOnPaper(state), false);
});

test('two backgroundings before one acknowledgement clears both', () => {
  let state = FOCUS_START;
  state = focusAfter(state, FOCUS_EVENTS.BACKGROUND);
  state = focusAfter(state, FOCUS_EVENTS.BACKGROUND);
  state = focusAfter(state, FOCUS_EVENTS.ACKNOWLEDGE);
  assert.equal(state.exits, 2);
  assert.equal(state.acknowledged, 2);
  assert.equal(isOnPaper(state), true);
});
