import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FEATURE_KEYS,
  FEATURE_KEY_VALUES,
  PERMISSION_LEVELS,
  can,
  type AdminPermissions,
  type FeatureKey,
  type PermissionLevel,
} from '@iace/contracts';
import { filterNavByPermission, type NavItem } from '@iace/app-kit';
import { NAV_ITEMS, ROUTES, ROUTE_ACCESS, filterAdminNav, opensRoute } from '../src/lib/constants';

const { READ, WRITE } = PERMISSION_LEVELS;

/** The guard's own rule over a set of grants, as the session hands it to every screen. */
const holding =
  (permissions: AdminPermissions, isSuperAdmin = false) =>
  (key: FeatureKey, level: PermissionLevel = READ) =>
    can({ isActive: true, isSuperAdmin, permissions }, key, level);

const opens = (path: string, permissions: AdminPermissions, isSuperAdmin = false) =>
  opensRoute(path, { isSuperAdmin, can: holding(permissions, isSuperAdmin) });

const everyPath = (items: readonly NavItem[]): string[] =>
  items.flatMap((item) => [...(item.to ? [item.to] : []), ...everyPath(item.children ?? [])]);

/** The rail as the shell draws it: the app strips what the viewer may not open, then the shell reads the keys. */
const railOf = (permissions: AdminPermissions, isSuperAdmin = false) => {
  const viewer = holding(permissions, isSuperAdmin);
  return everyPath(
    filterNavByPermission(filterAdminNav(NAV_ITEMS, { isSuperAdmin, can: viewer }), viewer),
  );
};

describe('a screen opened by its address', () => {
  it('is refused without Students, the imports under programs and events with it', () => {
    const tests = { [FEATURE_KEYS.TEST_MANAGEMENT]: WRITE };

    for (const path of [
      ROUTES.STUDENTS,
      ROUTES.STUDENT_PATTERN,
      ROUTES.COHORTS,
      ROUTES.EVENT_IMPORT_PATTERN,
      ROUTES.PROGRAM_IMPORT_PATTERN,
    ]) {
      assert.equal(opens(path, tests), false, path);
      assert.equal(opens(path, { [FEATURE_KEYS.STUDENT_MANAGEMENT]: WRITE }), true, path);
    }
  });

  it('keeps the bank for Question bank: a test owner reads its picker, not its screens', () => {
    const tests = { [FEATURE_KEYS.TEST_MANAGEMENT]: WRITE, [FEATURE_KEYS.DATA_EXPORT]: READ };
    const bank = { [FEATURE_KEYS.QUESTION_MANAGEMENT]: WRITE };

    for (const path of [
      ROUTES.QUESTIONS,
      ROUTES.QUESTION_NEW,
      ROUTES.QUESTION_PATTERN,
      ROUTES.QUESTION_EDIT_PATTERN,
    ]) {
      assert.equal(opens(path, tests), false, path);
      assert.equal(opens(path, bank), true, path);
    }
  });

  it('reads a question at READ and refuses to write one below WRITE', () => {
    const reader = { [FEATURE_KEYS.QUESTION_MANAGEMENT]: READ };

    assert.equal(opens(ROUTES.QUESTIONS, reader), true);
    assert.equal(opens(ROUTES.QUESTION_PATTERN, reader), true);
    for (const path of [ROUTES.QUESTION_NEW, ROUTES.QUESTION_EDIT_PATTERN]) {
      assert.equal(opens(path, reader), false, path);
    }
  });

  it("opens the bank's import on Question bank and a section's on Authoring, never crossed", () => {
    const typist = { [FEATURE_KEYS.QUESTION_AUTHORING]: WRITE };
    const bank = { [FEATURE_KEYS.QUESTION_MANAGEMENT]: WRITE };

    assert.equal(opens(ROUTES.IMPORT_QUESTIONS, bank), true);
    assert.equal(opens(ROUTES.IMPORT_QUESTIONS, typist), false);
    assert.equal(opens(ROUTES.AUTHORING_IMPORT_PATTERN, typist), true);
    assert.equal(opens(ROUTES.AUTHORING_IMPORT_PATTERN, bank), false);
    assert.equal(opens(ROUTES.IMPORT_QUESTIONS, {}), false);
  });

  it('refuses every new screen to a read-only Tests holder, who still reads what exists', () => {
    const reader = { [FEATURE_KEYS.TEST_MANAGEMENT]: READ };

    for (const path of [ROUTES.TEST_NEW, ROUTES.TEST_SERIES_NEW, ROUTES.BASE_CONFIG_NEW]) {
      assert.equal(opens(path, reader), false, path);
      assert.equal(opens(path, { [FEATURE_KEYS.TEST_MANAGEMENT]: WRITE }), true, path);
    }
    for (const path of [
      ROUTES.TESTS,
      ROUTES.TEST_PATTERN,
      ROUTES.TEST_SERIES_PATTERN,
      ROUTES.BASE_CONFIG_PATTERN,
      ROUTES.TEST_PAPER_PATTERN,
    ]) {
      assert.equal(opens(path, reader), true, path);
    }
  });

  it('refuses the blank editor to a read-only typist and takes it off the rail', () => {
    const reader = { [FEATURE_KEYS.QUESTION_AUTHORING]: READ };

    assert.equal(opens(ROUTES.AUTHORING_EDITOR, reader), false);
    assert.deepEqual(railOf(reader), [ROUTES.AUTHORING_ASSIGNMENTS, ROUTES.AUTHORING_HISTORY]);
    // What they wrote is still theirs to read, as the server answers it.
    for (const path of [ROUTES.AUTHORING_HISTORY, ROUTES.AUTHORING_EDITOR_PATTERN]) {
      assert.equal(opens(path, reader), true, path);
    }
  });

  it('gives a typist with WRITE the editor, on the rail and by address', () => {
    const typist = { [FEATURE_KEYS.QUESTION_AUTHORING]: WRITE };

    assert.equal(opens(ROUTES.AUTHORING_EDITOR, typist), true);
    assert.ok(railOf(typist).includes(ROUTES.AUTHORING_EDITOR));
  });

  it('opens a section to any of its three seats, and to nobody else', () => {
    for (const key of [
      FEATURE_KEYS.QUESTION_AUTHORING,
      FEATURE_KEYS.QUESTION_PROOFREAD,
      FEATURE_KEYS.TEST_MANAGEMENT,
    ]) {
      assert.equal(opens(ROUTES.READING_SECTION_PATTERN, { [key]: READ }), true, key);
    }
    assert.equal(
      opens(ROUTES.READING_SECTION_PATTERN, { [FEATURE_KEYS.QUESTION_MANAGEMENT]: WRITE }),
      false,
    );
  });

  /** The failure this prevents: a report's address opening a screen whose every request is refused. */
  it('opens Reports by address only with its key', () => {
    for (const path of [ROUTES.REPORTS, ROUTES.REPORT_PATTERN]) {
      assert.equal(opens(path, { [FEATURE_KEYS.TEST_MANAGEMENT]: WRITE }), false, path);
      assert.equal(opens(path, { [FEATURE_KEYS.REPORTS]: READ }), true, path);
    }
  });

  it('names no key for the screen every admin reaches', () => {
    assert.equal(opens(ROUTES.HOME, {}), true);
  });

  const SUPER_ADMIN_SCREENS = [
    ROUTES.ADMINS,
    ROUTES.PERMISSIONS,
    ROUTES.SECTION_PROGRESS,
    ROUTES.AUDIT,
    ROUTES.AUDIT_IMPORTS,
  ];

  /** The failure this prevents: the audit log, or who holds what, opened by typing its address with every key held. */
  it('opens a super admin’s screens to nobody else, whatever keys they hold', () => {
    const everyKey = Object.fromEntries(FEATURE_KEY_VALUES.map((key) => [key, WRITE]));

    for (const path of SUPER_ADMIN_SCREENS) {
      assert.equal(opens(path, everyKey), false, path);
      assert.equal(railOf(everyKey).includes(path), false, path);
    }
  });

  it('refuses a super admin nothing, on the rail or by address', () => {
    for (const path of [...Object.keys(ROUTE_ACCESS), ...SUPER_ADMIN_SCREENS]) {
      assert.equal(opens(path, {}, true), true, path);
    }
    assert.deepEqual(railOf({}, true), everyPath(NAV_ITEMS));
  });

  /** The failure this prevents: a row the shell draws on the section's key, leading to a refusal. */
  it('never leads from the rail to a refusal, whatever one key is held at READ', () => {
    for (const key of FEATURE_KEY_VALUES) {
      const grants = { [key]: READ };
      for (const path of railOf(grants)) {
        assert.equal(opens(path, grants), true, `${key} → ${path}`);
      }
    }
  });
});
