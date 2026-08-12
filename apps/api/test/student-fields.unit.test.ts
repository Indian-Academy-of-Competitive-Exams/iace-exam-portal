import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EARLIEST_BIRTH_YEAR,
  createStudentSchema,
  dobSchema,
  personNameSchema,
  todayISO,
  updateStudentSchema,
} from '@iace/contracts';

const shift = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

describe('dobSchema', () => {
  it('accepts a real date in the past', () => {
    assert.equal(dobSchema.safeParse('2003-04-11').success, true);
    assert.equal(dobSchema.safeParse(shift(-1)).success, true);
  });

  it('accepts today, since a newborn has a birth date', () => {
    assert.equal(dobSchema.safeParse(todayISO()).success, true);
  });

  it('REFUSES a future date', () => {
    // A DOB is one of the three fields the pre-test gate collects, so a
    // mistyped year does not merely sit in a profile — it marks a student
    // ready for a test on data that cannot be true.
    for (const future of [shift(1), shift(400), '2999-01-01']) {
      const parsed = dobSchema.safeParse(future);
      assert.equal(parsed.success, false, `expected ${future} to be refused`);
      if (!parsed.success) assert.match(parsed.error.issues[0]!.message, /cannot be in the future/);
    }
  });

  it('refuses a year that is obviously a typo', () => {
    assert.equal(dobSchema.safeParse(`${EARLIEST_BIRTH_YEAR - 1}-01-01`).success, false);
    assert.equal(dobSchema.safeParse('0203-04-11').success, false);
  });

  it('still refuses a malformed or impossible date', () => {
    for (const bad of ['11-04-2003', '2003/04/11', '2003-13-01', 'yesterday', '']) {
      assert.equal(dobSchema.safeParse(bad).success, false, `expected ${bad} to be refused`);
    }
  });
});

describe('personNameSchema', () => {
  it('accepts ordinary names, including scripts other than Latin', () => {
    for (const name of ['Asha', 'Ravi Teja', 'Lakshmi Devi', 'ఆశా', 'आशा']) {
      assert.equal(
        personNameSchema.safeParse(name).success,
        true,
        `expected ${name} to be accepted`,
      );
    }
  });

  it('accepts the marks that appear INSIDE real names', () => {
    // Initials and double-barrelled names are ordinary here; refusing them
    // would send admins looking for workarounds.
    for (const name of ['K. Ravi Kumar', "D'Souza", 'Anne-Marie']) {
      assert.equal(
        personNameSchema.safeParse(name).success,
        true,
        `expected ${name} to be accepted`,
      );
    }
  });

  it('REFUSES a comma — the spreadsheet artefact that prompted this', () => {
    const parsed = personNameSchema.safeParse('Kumari, Asha');
    assert.equal(parsed.success, false);
    if (!parsed.success) assert.match(parsed.error.issues[0]!.message, /letters only/);
  });

  it('refuses digits and symbols', () => {
    for (const bad of ['Asha123', 'Ravi@iace', 'Student #4', 'A_B', 'Asha/Ravi', '<script>']) {
      assert.equal(personNameSchema.safeParse(bad).success, false, `expected ${bad} to be refused`);
    }
  });

  it('refuses a name that does not start with a letter', () => {
    assert.equal(personNameSchema.safeParse('.Asha').success, false);
    assert.equal(personNameSchema.safeParse("'Asha").success, false);
    assert.equal(personNameSchema.safeParse('-Asha').success, false);
  });

  it('trims, so a stray space is not a different name', () => {
    assert.equal(personNameSchema.parse('  Asha Kumari  '), 'Asha Kumari');
  });
});

describe('the name rules reach the student schemas', () => {
  it('refuses a comma on create, and still allows no name at all', () => {
    assert.equal(
      createStudentSchema.safeParse({ mobile: '9876543210', fullName: 'Kumari, Asha' }).success,
      false,
    );
    assert.equal(createStudentSchema.safeParse({ mobile: '9876543210' }).success, true);
    assert.equal(
      createStudentSchema.safeParse({ mobile: '9876543210', fullName: '' }).success,
      true,
    );
  });

  it('refuses a comma on update, and still allows clearing the name', () => {
    assert.equal(updateStudentSchema.safeParse({ fullName: 'Kumari, Asha' }).success, false);
    assert.equal(updateStudentSchema.parse({ fullName: '' }).fullName, null);
    assert.equal(updateStudentSchema.parse({ fullName: null }).fullName, null);
  });

  it('applies the same rules to the parents’ names and the DOB', () => {
    assert.equal(
      updateStudentSchema.safeParse({ profile: { motherName: 'Sunitha 2' } }).success,
      false,
    );
    assert.equal(updateStudentSchema.safeParse({ profile: { dob: shift(30) } }).success, false);
    assert.equal(
      updateStudentSchema.safeParse({ profile: { motherName: 'Sunitha', dob: '1998-06-02' } })
        .success,
      true,
    );
  });
});
