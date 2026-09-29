import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { servedQuestions, type ExamPaper, type SharedPaper } from '@iace/contracts';
import { paperFor } from '../src/exam/served-paper';
import { testPaperQueryKey } from '../src/student-queries';

const SEED = 4242;

const rich = (text: string) => [{ type: 'TEXT' as const, text }];

const question = (id: string, section: string) => ({
  questionId: id,
  order: 0,
  baseConfigSectionId: section,
  type: 'SINGLE_MCQ' as const,
  marks: 2,
  negativeMarks: 0.5,
  content: { en: { stem: rich(id) } },
  options: ['a', 'b'].map((suffix) => ({
    id: `${id}_${suffix}`,
    position: 1,
    text: { en: rich(suffix) },
  })),
});

const shared = (): SharedPaper => ({
  languages: ['EN'],
  languageMode: 'SINGLE',
  examTemplate: 'DEFAULT',
  testUi: 'CBT',
  timerTemplate: 'COMPOSITE_FREE',
  navigation: 'FREE',
  calculatorEnabled: false,
  shuffleQuestions: true,
  shuffleOptions: true,
  sections: [],
  questions: [question('q1', 's1'), question('q2', 's1'), question('q3', 's1')],
});

const started = (over: { paper?: ExamPaper | null } = {}) =>
  ({
    id: 'att_1',
    testId: 'tst_1',
    languages: ['EN'],
    shuffleSeed: SEED,
    endsAt: '2026-09-29T11:00:00.000Z',
    serverNow: '2026-09-29T10:00:00.000Z',
    paper: over.paper ?? null,
  }) as never;

const refuse = () => Promise.reject(new Error('should not have fetched'));

/** Just the read `paperFor` asks for: a real query client's own timers outlive node:test. */
const heldPapers = (entries: Record<string, unknown> = {}) => ({
  getQueryData: <T>(key: readonly unknown[]) => entries[key.join('|')] as T | undefined,
});

describe('where a sitting gets its paper', () => {
  /** The whole point of holding it: the clock anchors on the START, never on the older held copy. */
  it('composes the held paper and anchors the clock on the start', async () => {
    const held = shared();
    const papers = heldPapers({ [testPaperQueryKey('tst_1', ['EN']).join('|')]: held });

    const paper = await paperFor(started(), papers, refuse);

    assert.equal(paper.attemptId, 'att_1');
    assert.equal(paper.serverNow, '2026-09-29T10:00:00.000Z');
    assert.equal(paper.endsAt, '2026-09-29T11:00:00.000Z');
    assert.deepEqual(
      paper.questions,
      servedQuestions(held.questions, SEED, held.shuffleQuestions, held.shuffleOptions),
    );
  });

  /** The bug this prevents: a held paper for one language set serving a sitting of another. */
  it('ignores a held paper keyed to different languages', async () => {
    const papers = heldPapers({ [testPaperQueryKey('tst_1', ['HI']).join('|')]: shared() });
    const sent = { attemptId: 'att_1' } as ExamPaper;

    assert.equal(await paperFor(started({ paper: sent }), papers, refuse), sent);
  });

  it('takes what the start answered with when nothing was held', async () => {
    const sent = { attemptId: 'att_1' } as ExamPaper;

    assert.equal(await paperFor(started({ paper: sent }), heldPapers(), refuse), sent);
  });

  it('fetches only when neither a held nor a sent paper exists', async () => {
    const fetched = { attemptId: 'att_1' } as ExamPaper;

    const paper = await paperFor(started(), heldPapers(), () => Promise.resolve(fetched));

    assert.equal(paper, fetched);
  });
});
