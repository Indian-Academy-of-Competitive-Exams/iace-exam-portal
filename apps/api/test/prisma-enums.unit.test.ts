import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  ActorTypes,
  ANSWER_MODE,
  ANSWER_STATE,
  ATTEMPT_STATUS,
  AUDIT_ACTION,
  AUDIT_ACTOR_TYPE,
  AUDIT_FEATURE,
  BRANCH_TYPE,
  DIFFICULTY_LEVEL,
  DRAW_STRATEGY,
  EVALUATION_MODE,
  EXAM_COURSE,
  EXAM_MODE,
  IMPORT_SOURCE,
  LANGUAGE_CODE,
  LANGUAGE_MODE,
  MERIT_TYPE,
  NAVIGATION_POLICY,
  NOTIFICATION_TYPE,
  PAPER_BINDING,
  PAPER_QUESTION_STATUS,
  PERMISSION_LEVELS,
  QUESTION_STATUS,
  QUESTION_TYPE,
  STAGE_DISPOSITION,
  STUDENT_TYPE,
  TEST_SCOPE,
  TEST_STATUS,
  TEST_UI,
  TIMER_TEMPLATE,
  UNLOCK_MODE,
  UNLOCK_REQUEST_STATUS,
  UNLOCK_STATE,
  actorTypeSchema,
} from '@iace/contracts';

/**
 * The two sides of every shared enum: a const object in contracts, and a Prisma enum the database
 * stores. A value present on one side and not the other is a runtime failure no type catches — the
 * guard compares strings the column cannot hold, or a write dies at the driver.
 */
const SCHEMA = readFileSync(join(__dirname, '../../../prisma/schema.prisma'), 'utf8');

const MIRRORED = {
  StudentType: STUDENT_TYPE,
  BranchType: BRANCH_TYPE,
  ImportSource: IMPORT_SOURCE,
  AuditFeature: AUDIT_FEATURE,
  AuditAction: AUDIT_ACTION,
  ActorType: AUDIT_ACTOR_TYPE,
  QuestionType: QUESTION_TYPE,
  DifficultyLevel: DIFFICULTY_LEVEL,
  QuestionStatus: QUESTION_STATUS,
  PermissionLevel: PERMISSION_LEVELS,
  ExamCourse: EXAM_COURSE,
  ExamMode: EXAM_MODE,
  StageDisposition: STAGE_DISPOSITION,
  SupportedLanguage: LANGUAGE_CODE,
  TimerTemplate: TIMER_TEMPLATE,
  NavigationPolicy: NAVIGATION_POLICY,
  LanguageMode: LANGUAGE_MODE,
  TestUi: TEST_UI,
  MeritType: MERIT_TYPE,
  TestStatus: TEST_STATUS,
  TestScope: TEST_SCOPE,
  EvaluationMode: EVALUATION_MODE,
  PaperBinding: PAPER_BINDING,
  DrawStrategy: DRAW_STRATEGY,
  PaperQuestionStatus: PAPER_QUESTION_STATUS,
  AttemptStatus: ATTEMPT_STATUS,
  AnswerMode: ANSWER_MODE,
  AnswerState: ANSWER_STATE,
  UnlockMode: UNLOCK_MODE,
  UnlockState: UNLOCK_STATE,
  UnlockRequestStatus: UNLOCK_REQUEST_STATUS,
  NotificationType: NOTIFICATION_TYPE,
} as const;

function prismaEnum(name: string): string[] {
  const block = new RegExp(String.raw`enum ${name} \{([^}]*)\}`).exec(SCHEMA);
  assert.ok(block, `schema.prisma has no enum ${name}`);
  return (block[1] ?? '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => line.length > 0);
}

describe('Prisma enums mirror the const objects in contracts', () => {
  for (const [prismaName, constant] of Object.entries(MIRRORED)) {
    // Order too, not just membership: `orderBy: { type: 'desc' }` on Branch puts
    // the virtual branch first only because VIRTUAL is declared last.
    it(`${prismaName} carries exactly its const object's values, in order`, () => {
      assert.deepEqual(prismaEnum(prismaName), Object.values(constant));
    });

    it(`${prismaName}'s const object keys each equal their value`, () => {
      for (const [key, value] of Object.entries(constant)) assert.equal(key, value);
    });
  }
});

/**
 * The reason the audit actor is its own enum: `ActorTypes` decides which table a token's identity is
 * read from, and nothing signs in as a script or as the system.
 */
describe('the token actor stays narrower than the audit actor', () => {
  it('admits only a student and an admin', () => {
    assert.deepEqual(Object.values(ActorTypes), ['STUDENT', 'ADMIN']);
  });

  it('refuses SCRIPT and SYSTEM', () => {
    assert.equal(actorTypeSchema.safeParse(AUDIT_ACTOR_TYPE.SCRIPT).success, false);
    assert.equal(actorTypeSchema.safeParse(AUDIT_ACTOR_TYPE.SYSTEM).success, false);
  });
});
