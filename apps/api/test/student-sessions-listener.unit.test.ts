import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ActorTypes } from '@iace/contracts';
import { StudentSessionsListener } from '../src/auth/student-sessions.listener';
import { SessionService } from '../src/auth/session.service';
import { FakeRedis, NO_DEVICE } from './support/fakes';

const SUBJECT = 'stu_1';
const TTL = 3600;

describe('StudentSessionsListener', () => {
  it('signs out every device the instant a deactivation lands', async () => {
    const sessions = new SessionService(new FakeRedis().asService());
    const sessionId = sessions.newSessionId();
    await sessions.create(ActorTypes.STUDENT, SUBJECT, sessionId, 'refresh-1', NO_DEVICE, TTL);
    const listener = new StudentSessionsListener(sessions);

    await listener.onStudentDeactivated({ studentId: SUBJECT });

    assert.equal(await sessions.exists(ActorTypes.STUDENT, SUBJECT, sessionId), false);
  });

  /** The write already happened. A Redis blip must not fail the producer that reported it. */
  it('swallows a failing revocation rather than failing the producer', async () => {
    const failing = {
      revokeAll: () => Promise.reject(new Error('redis is down')),
    } as unknown as SessionService;
    const listener = new StudentSessionsListener(failing);

    await assert.doesNotReject(() => listener.onStudentDeactivated({ studentId: SUBJECT }));
  });
});
