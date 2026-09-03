import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EVALUATION_MODE,
  TEST_SCOPE,
  TEST_SERIES_KIND,
  nameStem,
  seriesNameKind,
  suggestedSeriesName,
  suggestedTestName,
  testNameKind,
} from '../src/index';

const MOCK_STEM = 'SSC CGL Tier 1 Standard — Mock';

describe('nameStem', () => {
  it('joins what a name says before its number', () => {
    assert.equal(nameStem(['SSC CGL', 'Tier 1', 'Standard'], 'Mock'), MOCK_STEM);
  });

  /** The failure this prevents: "SSC_CGL Tier 1 SSC CGL Tier 1 — official pattern — Mock 01". */
  it('drops a part the name has already said, whatever separates its words', () => {
    assert.equal(
      nameStem(['SSC CGL', 'Tier 1', 'SSC CGL Tier 1 — official pattern'], 'Mock'),
      'SSC CGL Tier 1 — Mock',
    );
    assert.equal(
      nameStem(['SSC_CGL', 'Tier 1', 'SSC CGL Tier 1 — official pattern'], 'Mock'),
      'SSC CGL Tier 1 — Mock',
    );
  });

  /** The blueprint is the official pattern; a test drawn from it is one of a run under that name. */
  it('drops the official pattern marker in either shape a config writes it', () => {
    assert.equal(
      nameStem(['IBPS PO', 'Prelims (official pattern)'], 'Mock'),
      'IBPS PO Prelims — Mock',
    );
    assert.equal(
      nameStem(['IBPS PO', 'Prelims — official pattern'], 'Mock'),
      'IBPS PO Prelims — Mock',
    );
  });

  /** Only the trailing marker goes: a parenthetical that tells two blueprints apart is the name. */
  it('keeps a parenthetical that is not the marker', () => {
    assert.equal(
      nameStem(['RRB ALP', 'CBT 2 - Part B (Trade) (official pattern)'], 'Mock'),
      'RRB ALP CBT 2 - Part B (Trade) — Mock',
    );
  });

  /** Most configs interleave a word the code left out, so a contiguous match would miss them. */
  it('drops what was already said even when the config puts words between', () => {
    assert.equal(
      nameStem(['IBPS_PO', 'Prelims', 'IBPS PO / MT — Prelims (official pattern)'], 'Mock'),
      'IBPS PO / MT — Prelims — Mock',
    );
  });

  /** Tier 10 only starts like Tier 1, so a blind substring would swallow the stage it is not. */
  it('matches whole words rather than the start of one', () => {
    assert.equal(nameStem(['Tier 1', 'Tier 10'], 'Mock'), 'Tier 1 Tier 10 — Mock');
  });

  it('keeps a config that names something the stage did not', () => {
    assert.equal(
      nameStem(['SSC CGL', 'Tier 1', 'Revised 2026'], 'Mock'),
      'SSC CGL Tier 1 Revised 2026 — Mock',
    );
  });

  /** A form is filled in one field at a time, so the stem has to read while half of it is missing. */
  it('leaves out the parts that are not chosen yet', () => {
    assert.equal(nameStem(['SSC CGL', '', null], 'Mock'), 'SSC CGL — Mock');
    assert.equal(nameStem([undefined, '  '], 'Mock'), 'Mock');
  });
});

describe('suggestedTestName', () => {
  it('starts a run at one, padded so a list of them lines up', () => {
    assert.equal(suggestedTestName(MOCK_STEM, []), `${MOCK_STEM} 01`);
  });

  /** The failure this prevents: a deleted Mock 03 making the next suggestion collide with Mock 04. */
  it('goes past the highest taken, not past the count', () => {
    const taken = [`${MOCK_STEM} 01`, `${MOCK_STEM} 02`, `${MOCK_STEM} 04`];
    assert.equal(suggestedTestName(MOCK_STEM, taken), `${MOCK_STEM} 05`);
  });

  it('counts only names under its own stem', () => {
    const taken = [`${MOCK_STEM} 07`, 'SSC CGL Tier 1 Standard — Practice 09', 'Something else 12'];
    assert.equal(
      suggestedTestName('SSC CGL Tier 1 Standard — Practice', taken),
      'SSC CGL Tier 1 Standard — Practice 10',
    );
  });

  /** A stem is a prefix, so a longer name starting with it must not be read as a number. */
  it('ignores a name that only begins like the stem', () => {
    assert.equal(suggestedTestName(MOCK_STEM, [`${MOCK_STEM} Drill 08`]), `${MOCK_STEM} 01`);
  });

  it('runs past nine into two digits without losing the padding', () => {
    assert.equal(suggestedTestName(MOCK_STEM, [`${MOCK_STEM} 09`]), `${MOCK_STEM} 10`);
  });
});

describe('suggestedSeriesName', () => {
  const stem = 'SSC CGL Tier 1 — Mock Test Series';

  /** There is usually one series under a stem, and "Series 01" reads like there are more. */
  it('leaves a free stem unnumbered', () => {
    assert.equal(suggestedSeriesName(stem, ['Something else']), stem);
  });

  it('numbers from two once the plain name is taken', () => {
    assert.equal(suggestedSeriesName(stem, [stem]), `${stem} 02`);
  });

  it('goes past the highest when numbered ones already exist', () => {
    assert.equal(suggestedSeriesName(stem, [stem, `${stem} 02`, `${stem} 05`]), `${stem} 06`);
  });
});

describe('testNameKind', () => {
  it('calls a ranked full paper a mock, and a practice one practice', () => {
    const full = { scope: TEST_SCOPE.FULL, scopeName: 'ignored' };
    assert.equal(testNameKind({ ...full, evaluationMode: EVALUATION_MODE.RANKED }), 'Mock');
    assert.equal(testNameKind({ ...full, evaluationMode: EVALUATION_MODE.PRACTICE }), 'Practice');
  });

  /** A sectional test is known by its section, never by the word "sectional". */
  it('names a narrowed test after the part it covers', () => {
    assert.equal(
      testNameKind({
        scope: TEST_SCOPE.SECTIONAL,
        evaluationMode: EVALUATION_MODE.RANKED,
        scopeName: 'Quantitative Aptitude',
      }),
      'Quantitative Aptitude',
    );
  });

  /** The scope is chosen before the section it points at, so the name cannot wait for one. */
  it('falls back while the section is still unchosen', () => {
    assert.equal(
      testNameKind({ scope: TEST_SCOPE.SECTIONAL, evaluationMode: EVALUATION_MODE.RANKED }),
      'Mock',
    );
  });
});

describe('seriesNameKind', () => {
  it('names a program-only series after the program that reaches it', () => {
    assert.equal(seriesNameKind({ programCode: 'FOUNDATION' }), 'FOUNDATION');
  });

  it('separates the free tier from the ordinary one', () => {
    assert.equal(seriesNameKind({ kind: TEST_SERIES_KIND.FREE }), 'Free Mocks');
    assert.equal(seriesNameKind({ kind: TEST_SERIES_KIND.EVENT }), 'Event Test');
    assert.equal(seriesNameKind({}), 'Mock Test Series');
  });

  /** A program wins: it is the narrower fact, and a free program series is still that program's. */
  it('prefers the program over the free tier', () => {
    assert.equal(
      seriesNameKind({ programCode: 'FOUNDATION', kind: TEST_SERIES_KIND.FREE }),
      'FOUNDATION',
    );
  });
});
