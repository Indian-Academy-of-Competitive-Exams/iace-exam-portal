import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Reflector } from '@nestjs/core';
import { FEATURE_KEYS, PERMISSION_LEVELS } from '@iace/contracts';
import { AuthoringController } from '../src/questions/authoring.controller';
import { QuestionsController } from '../src/questions/questions.controller';
import { TaxonomyController } from '../src/questions/taxonomy.controller';
import { REQUIRED_FEATURE_KEY, type RequiredFeature } from '../src/common/security';

/** What `getAllAndOverride` takes: a handler or the class it hangs off. */
type Reflected = Parameters<Reflector['getAllAndOverride']>[1][number];

describe('what the authoring routes charge', () => {
  const reflector = new Reflector();
  const demanded = (handler: Reflected) =>
    reflector.getAllAndOverride<RequiredFeature | undefined, string>(REQUIRED_FEATURE_KEY, [
      handler,
      AuthoringController,
    ]);

  /** The failure this prevents: a typist reaching the bank because the nav was the only gate. */
  it('charges every route QUESTION_AUTHORING, at the level the act deserves', () => {
    const priced = [
      [AuthoringController.prototype.tags, PERMISSION_LEVELS.READ],
      [AuthoringController.prototype.stats, PERMISSION_LEVELS.READ],
      [AuthoringController.prototype.history, PERMISSION_LEVELS.READ],
      [AuthoringController.prototype.detail, PERMISSION_LEVELS.READ],
      [AuthoringController.prototype.create, PERMISSION_LEVELS.WRITE],
      [AuthoringController.prototype.update, PERMISSION_LEVELS.WRITE],
    ] as const;

    for (const [handler, level] of priced) {
      assert.deepEqual(demanded(handler), { key: FEATURE_KEYS.QUESTION_AUTHORING, level });
    }
  });

  it('opens the two reads both entry paths need to either key, and nothing else', () => {
    const both = [FEATURE_KEYS.QUESTION_MANAGEMENT, FEATURE_KEYS.QUESTION_AUTHORING];
    const shared = (handler: Reflected, target: Reflected) =>
      reflector.getAllAndOverride<RequiredFeature | undefined, string>(REQUIRED_FEATURE_KEY, [
        handler,
        target,
      ]);

    assert.deepEqual(shared(TaxonomyController.prototype.listSubjects, TaxonomyController), {
      key: both,
      level: PERMISSION_LEVELS.READ,
    });
    assert.deepEqual(shared(TaxonomyController.prototype.listTopics, TaxonomyController), {
      key: both,
      level: PERMISSION_LEVELS.READ,
    });
    assert.deepEqual(shared(QuestionsController.prototype.uploadImage, QuestionsController), {
      key: both,
      level: PERMISSION_LEVELS.WRITE,
    });

    // The bank itself stays the bank's: authoring is not a second door onto it.
    assert.deepEqual(shared(QuestionsController.prototype.list, QuestionsController), {
      key: FEATURE_KEYS.QUESTION_MANAGEMENT,
      level: PERMISSION_LEVELS.READ,
    });
  });
});
