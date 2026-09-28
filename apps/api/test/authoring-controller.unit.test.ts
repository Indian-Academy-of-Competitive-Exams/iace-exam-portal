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

  it('opens the taxonomy to everyone who files, reads or picks a question, and nothing else', () => {
    const both = [FEATURE_KEYS.QUESTION_MANAGEMENT, FEATURE_KEYS.QUESTION_AUTHORING];
    const readers = [...both, FEATURE_KEYS.QUESTION_PROOFREAD, FEATURE_KEYS.TEST_MANAGEMENT];
    const shared = (handler: Reflected, target: Reflected) =>
      reflector.getAllAndOverride<RequiredFeature | undefined, string>(REQUIRED_FEATURE_KEY, [
        handler,
        target,
      ]);

    assert.deepEqual(shared(TaxonomyController.prototype.listSubjects, TaxonomyController), {
      key: readers,
      level: PERMISSION_LEVELS.READ,
    });
    assert.deepEqual(shared(TaxonomyController.prototype.listTopics, TaxonomyController), {
      key: readers,
      level: PERMISSION_LEVELS.READ,
    });
    // A proof-reader puts pictures in a section's thread, so the one upload path admits them too.
    assert.deepEqual(shared(QuestionsController.prototype.uploadImage, QuestionsController), {
      key: [...both, FEATURE_KEYS.QUESTION_PROOFREAD],
      level: PERMISSION_LEVELS.WRITE,
    });

    // The bank itself stays the bank's: authoring is not a second door onto it.
    assert.deepEqual(shared(QuestionsController.prototype.detail, QuestionsController), {
      key: FEATURE_KEYS.QUESTION_MANAGEMENT,
      level: PERMISSION_LEVELS.READ,
    });
  });

  /** The failure this prevents: a test owner told they may not read the bank they are picking from. */
  it('lets a test owner make the picker’s two reads, and only those', () => {
    const picker = [FEATURE_KEYS.QUESTION_MANAGEMENT, FEATURE_KEYS.TEST_MANAGEMENT];
    const on = (handler: Reflected) =>
      reflector.getAllAndOverride<RequiredFeature | undefined, string>(REQUIRED_FEATURE_KEY, [
        handler,
        QuestionsController,
      ]);

    for (const handler of [
      QuestionsController.prototype.list,
      QuestionsController.prototype.availability,
    ]) {
      assert.deepEqual(on(handler), { key: picker, level: PERMISSION_LEVELS.READ });
    }
    for (const handler of [
      QuestionsController.prototype.detail,
      QuestionsController.prototype.versions,
      QuestionsController.prototype.update,
    ]) {
      assert.equal(on(handler)?.key, FEATURE_KEYS.QUESTION_MANAGEMENT);
    }
  });
});
