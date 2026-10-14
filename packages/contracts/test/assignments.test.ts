import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ASSIGNMENT_ROLES,
  DUE_STANDINGS,
  PAPER_SOURCES,
  dueStanding,
  paperBlockerOf,
} from '../src/index';

/** Due on the 9th, kept as that day's last instant at the institute. */
const DUE = '2026-10-09T18:29:59.999Z';

describe('dueStanding', () => {
  it('judges nothing without a due day', () => {
    assert.equal(dueStanding({ dueAt: null, finalizedAt: null }, '2026-12-01'), null);
    assert.equal(dueStanding({ dueAt: null, finalizedAt: DUE }, '2026-12-01'), null);
  });

  it('leaves an open section alone until its due day is over', () => {
    assert.equal(dueStanding({ dueAt: DUE, finalizedAt: null }, '2026-10-09'), null);
    assert.equal(
      dueStanding({ dueAt: DUE, finalizedAt: null }, '2026-10-10'),
      DUE_STANDINGS.OVERDUE,
    );
  });

  /** The failure this prevents: 23:30 IST on the due day is the NEXT day in UTC, and read as late. */
  it('counts a finish late on the due day at the institute as on time', () => {
    const lateEvening = '2026-10-09T18:00:00.000Z';
    const pastMidnight = '2026-10-09T18:30:00.000Z';

    assert.equal(dueStanding({ dueAt: DUE, finalizedAt: lateEvening }), DUE_STANDINGS.ON_TIME);
    assert.equal(dueStanding({ dueAt: DUE, finalizedAt: pastMidnight }), DUE_STANDINGS.LATE);
  });

  it('reads a due day kept at UTC midnight, as rows from before were, as the same day', () => {
    const before = '2026-10-09T00:00:00.000Z';

    assert.equal(
      dueStanding({ dueAt: before, finalizedAt: '2026-10-09T12:00:00.000Z' }),
      DUE_STANDINGS.ON_TIME,
    );
  });
});

describe('paperBlockerOf', () => {
  const SECTIONS = [
    { id: 'r', name: 'Reasoning' },
    { id: 'q', name: 'Quant' },
  ];
  const reader = (section: string, finalizedAt: string | null = DUE, replacedAt = null) => ({
    baseConfigSectionId: section,
    role: ASSIGNMENT_ROLES.PROOFREADER,
    finalizedAt,
    replacedAt,
  });
  const test = (paperQuestionCount = 5) => ({
    paperQuestionCount,
    totalQuestions: 5,
    finalizedAt: null,
    paperSource: PAPER_SOURCES.PICKED,
  });
  const blocker = (input: Partial<Parameters<typeof paperBlockerOf>[0]>) =>
    paperBlockerOf({
      test: test(),
      sections: SECTIONS,
      assignments: [reader('r'), reader('q')],
      skipsReading: false,
      ...input,
    });

  it('lets a whole paper whose every section is read through', () => {
    assert.equal(blocker({}), null);
  });

  it('holds a short paper, even for a super admin', () => {
    assert.match(blocker({ test: test(3), skipsReading: true }) ?? '', /3 of 5 questions/);
  });

  /** THE failure this prevents: Next past a paper nobody was asked to read. */
  it('names the sections with no proof-reader', () => {
    assert.match(
      blocker({ assignments: [reader('q'), reader('r', DUE, '2026-10-01' as never)] }) ?? '',
      /no proof-reader: Reasoning/,
    );
  });

  it('names the sections still being read, and a typed paper waits on its typist', () => {
    assert.match(blocker({ assignments: [reader('r', null), reader('q')] }) ?? '', /Reasoning/);
    const typist = { ...reader('q', null), role: ASSIGNMENT_ROLES.TYPIST };
    assert.equal(blocker({ assignments: [reader('r'), reader('q'), typist] }), null);
    assert.match(
      blocker({
        test: { ...test(), paperSource: PAPER_SOURCES.FRAMED },
        assignments: [reader('r'), reader('q'), typist],
      }) ?? '',
      /Quant/,
    );
  });

  it('lets a super admin past the reading, and an offered paper past everything', () => {
    assert.equal(blocker({ assignments: [], skipsReading: true }), null);
    assert.equal(blocker({ test: { ...test(3), finalizedAt: DUE }, assignments: [] }), null);
  });
});
