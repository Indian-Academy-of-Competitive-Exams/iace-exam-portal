import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Reflector } from '@nestjs/core';
import { FEATURE_KEYS, PERMISSION_LEVELS } from '@iace/contracts';
import { ProofreadingController } from '../src/questions/proofreading.controller';
import {
  REQUIRED_FEATURE_KEY,
  SUPER_ADMIN_KEY,
  type RequiredFeature,
} from '../src/common/security';

type Reflected = Parameters<Reflector['getAllAndOverride']>[1][number];

const reflector = new Reflector();

const superAdminOnly = (handler: Reflected) =>
  reflector.getAllAndOverride<boolean | undefined, string>(SUPER_ADMIN_KEY, [
    handler,
    ProofreadingController,
  ]) === true;

const demanded = (handler: Reflected) =>
  reflector.getAllAndOverride<RequiredFeature | undefined, string>(REQUIRED_FEATURE_KEY, [
    handler,
    ProofreadingController,
  ]);

describe('what the proof-reading routes charge', () => {
  /** The section-keyed way in has no assignment behind it, so nothing but super admin gates it. */
  it('keeps every section-keyed route to a super admin', () => {
    const keyedOnTheSection = [
      ProofreadingController.prototype.forSection,
      ProofreadingController.prototype.sectionOtherTests,
      ProofreadingController.prototype.editSectionQuestion,
    ];

    for (const handler of keyedOnTheSection) {
      assert.equal(superAdminOnly(handler), true);
    }
  });

  /** An ordinary reader still comes in through the assignment that named them, at its own price. */
  it('leaves the assignment routes on the proof-reading key', () => {
    assert.equal(superAdminOnly(ProofreadingController.prototype.forAssignment), false);

    assert.deepEqual(demanded(ProofreadingController.prototype.forAssignment), {
      key: FEATURE_KEYS.QUESTION_PROOFREAD,
      level: PERMISSION_LEVELS.READ,
    });
    assert.deepEqual(demanded(ProofreadingController.prototype.editQuestion), {
      key: FEATURE_KEYS.QUESTION_PROOFREAD,
      level: PERMISSION_LEVELS.WRITE,
    });
  });
});
