import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { Logger } from '@nestjs/common';
import { ActorTypes } from '@iace/contracts';
import { ConsoleMessageSender } from '../src/common/messaging/console-message-sender';
import { MESSAGE_CHANNELS, MESSAGE_KINDS, type OutboundMessage } from '../src/common/messaging';

/**
 * The dev sender's only job is to be READABLE, and the thing that stops it being readable is a row
 * wider than the border it is drawn inside.
 */
function render(over: Partial<OutboundMessage> = {}): string[] {
  const logged: string[] = [];
  const spy = mock.method(Logger.prototype, 'log', (message: string) => void logged.push(message));

  new ConsoleMessageSender().send({
    channel: MESSAGE_CHANNELS.SMS,
    kind: MESSAGE_KINDS.OTP,
    to: '9876543210',
    actor: ActorTypes.STUDENT,
    body: '123456 is your IACE verification code. It expires in 300 seconds.',
    ...over,
  });

  spy.mock.restore();
  return (logged[0] ?? '').split('\n').filter((line) => line.trim() !== '');
}

/** Every line of a well-formed box is exactly as wide as every other line. */
function assertBoxIsSquare(lines: string[]): void {
  const widths = new Set(lines.map((line) => line.length));
  assert.equal(widths.size, 1, `ragged box:\n${lines.join('\n')}`);
  assert.ok(lines[0]?.includes('┌'), 'opens with a top border');
  assert.ok(lines.at(-1)?.includes('└'), 'closes with a bottom border');
}

describe('ConsoleMessageSender', () => {
  it('draws a square box for an ordinary OTP', () => {
    const lines = render();

    assertBoxIsSquare(lines);
    assert.ok(
      lines.some((line) => line.includes('123456')),
      'the code is in there',
    );
  });

  it('wraps a body that would otherwise run through the border', () => {
    const lines = render({
      body: 'A very long message '.repeat(20),
    });

    assertBoxIsSquare(lines);
  });

  it('breaks a single word too wide for the box', () => {
    // No spaces to break on. Left alone, this is one 200-character row inside a
    // 72-character border.
    const lines = render({ to: 'x'.repeat(200) });

    assertBoxIsSquare(lines);
  });

  it('stays square with an email subject and no body wrapping', () => {
    const lines = render({
      channel: MESSAGE_CHANNELS.EMAIL,
      actor: ActorTypes.ADMIN,
      to: 'admin@iace.co.in',
      subject: 'Your IACE verification code',
      body: '123456',
    });

    assertBoxIsSquare(lines);
  });
});
