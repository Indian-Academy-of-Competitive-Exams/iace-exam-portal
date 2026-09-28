import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ASSIGNMENT_ROLES, type AssignmentWithTest } from '@iace/contracts';
import {
  SECTION_ADD,
  SECTION_AS,
  SECTION_MOMENTS,
  SECTION_PRIMARY,
  SECTION_VIEWERS,
  momentOf,
  seatOf,
  slotsFor,
} from '../src/components/authoring/section-moment';

const DONE = '2026-09-28T06:00:00.000Z';

const row = (over: Partial<AssignmentWithTest>): AssignmentWithTest => ({
  id: 'a',
  testId: 't',
  baseConfigSectionId: 's',
  sectionName: 'Quantitative Aptitude',
  assigneeId: 'me',
  assigneeName: 'Me',
  role: ASSIGNMENT_ROLES.TYPIST,
  dueAt: null,
  finalizedAt: null,
  writtenCount: 0,
  typistDone: false,
  readerDone: false,
  testOffered: false,
  handedAt: null,
  replacedAt: null,
  removable: null,
  sectionQuestionCount: 25,
  sectionMix: null,
  sectionSubjectId: null,
  testTitle: 'Mock 4',
  ...over,
});

const typing = row({});
const reading = row({ id: 'r', role: ASSIGNMENT_ROLES.PROOFREADER });

describe('seatOf', () => {
  it('seats the reader only when their row is asked for, or is the only one', () => {
    assert.equal(seatOf([typing, reading], null).viewer, SECTION_VIEWERS.TYPIST);
    assert.equal(seatOf([typing, reading], SECTION_AS.READER).viewer, SECTION_VIEWERS.READER);
    assert.equal(seatOf([reading], null).viewer, SECTION_VIEWERS.READER);
    assert.equal(seatOf([], null).viewer, SECTION_VIEWERS.OWNER);
  });
});

describe('the section a typist opens', () => {
  it('offers Done and adds into the section while typing', () => {
    const seat = seatOf([typing], null);
    const slots = slotsFor(seat, momentOf(seat, false), false);

    assert.equal(slots.primary, SECTION_PRIMARY.DONE);
    assert.equal(slots.add, SECTION_ADD.INTO_SECTION);
    assert.equal(slots.editable, true);
  });

  /** The failure this prevents: a question typed after Done landing on the paper the reader has. */
  it('sends new questions to the bank once done, and locks the section once read', () => {
    const done = seatOf([row({ finalizedAt: DONE, typistDone: true })], null);
    assert.equal(momentOf(done, false), SECTION_MOMENTS.READING);
    assert.equal(slotsFor(done, SECTION_MOMENTS.READING, false).add, SECTION_ADD.TO_BANK);

    const read = seatOf([row({ finalizedAt: DONE, typistDone: true, readerDone: true })], null);
    assert.equal(momentOf(read, false), SECTION_MOMENTS.READ);
    assert.equal(slotsFor(read, SECTION_MOMENTS.READ, false).editable, false);
  });
});

describe('the section a reader opens', () => {
  it('waits for the typist, then reads', () => {
    const waiting = seatOf([reading], null);
    assert.equal(momentOf(waiting, false), SECTION_MOMENTS.WAITING);
    assert.equal(slotsFor(waiting, SECTION_MOMENTS.WAITING, false).primary, null);

    const typed = seatOf([row({ role: ASSIGNMENT_ROLES.PROOFREADER, typistDone: true })], null);
    const slots = slotsFor(typed, momentOf(typed, false), false);
    assert.equal(slots.primary, SECTION_PRIMARY.READ);
  });
});

describe('the section a test owner opens', () => {
  it('is read-only but for a super admin, and frozen once offered', () => {
    const owner = seatOf([], null);
    assert.equal(slotsFor(owner, SECTION_MOMENTS.BUILDING, false).editable, false);
    assert.equal(slotsFor(owner, SECTION_MOMENTS.BUILDING, true).editable, true);
    assert.equal(momentOf(seatOf([typing], null), true), SECTION_MOMENTS.OFFERED);
    assert.equal(slotsFor(owner, SECTION_MOMENTS.OFFERED, true).editable, false);
  });
});
