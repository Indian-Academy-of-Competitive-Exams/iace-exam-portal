import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Reflector } from '@nestjs/core';
import { FEATURE_KEYS, PERMISSION_LEVELS } from '@iace/contracts';
import { SectionWorkController } from '../src/questions/section-work.controller';
import {
  REQUIRED_FEATURE_KEY,
  SUPER_ADMIN_KEY,
  type RequiredFeature,
} from '../src/common/security';

type Reflected = Parameters<Reflector['getAllAndOverride']>[1][number];

const reflector = new Reflector();

const demanded = (handler: Reflected) =>
  reflector.getAllAndOverride<RequiredFeature | undefined, string>(REQUIRED_FEATURE_KEY, [
    handler,
    SectionWorkController,
  ]);

const superAdminOnly = (handler: Reflected) =>
  reflector.getAllAndOverride<boolean | undefined, string>(SUPER_ADMIN_KEY, [
    handler,
    SectionWorkController,
  ]) === true;

const ANY_SEAT = [
  FEATURE_KEYS.QUESTION_AUTHORING,
  FEATURE_KEYS.QUESTION_PROOFREAD,
  FEATURE_KEYS.TEST_MANAGEMENT,
];

describe('what the section work routes charge', () => {
  /** The guard only says they work on sections; the service decides whether this one is theirs. */
  it('lets any of the three keys in, reading at read and changing at write', () => {
    const { prototype } = SectionWorkController;
    const priced = [
      [prototype.one, PERMISSION_LEVELS.READ],
      [prototype.question, PERMISSION_LEVELS.READ],
      [prototype.otherTests, PERMISSION_LEVELS.READ],
      [prototype.edit, PERMISSION_LEVELS.WRITE],
      [prototype.check, PERMISSION_LEVELS.WRITE],
      [prototype.uncheck, PERMISSION_LEVELS.WRITE],
      [prototype.sendBack, PERMISSION_LEVELS.WRITE],
      [prototype.fixed, PERMISSION_LEVELS.WRITE],
    ] as const;

    for (const [handler, level] of priced) {
      assert.equal(superAdminOnly(handler), false);
      assert.deepEqual(demanded(handler), { key: ANY_SEAT, level });
    }
  });
});
