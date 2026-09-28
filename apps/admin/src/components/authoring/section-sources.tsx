import { useMemo } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  plainTextOf,
  previewTextOf,
  type DifficultyLevel,
  type QuestionDetail,
  type QuestionDraftInput,
  type QuestionOnOtherTest,
} from '@iace/contracts';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';
import { OtherTestsNotice } from '../cross-test-warning';
import { type Held, type QuestionsSource } from './questions-window';
import { headerOf, stateOf, toDraft } from './question-scaffold';
import { SECTION_VIEWERS, type SectionSeat } from './section-moment';
import { sectionQuestions } from './section-questions';

/** One line of the section's grid, whichever list it came from. */
export interface SectionRow {
  id: string;
  preview: string;
  difficulty: DifficultyLevel;
}

export interface SectionKey {
  testId: string;
  sectionId: string;
}

/** The calls a viewer reaches a question through: their own row where they hold one, the section's pair where they do not. */
interface Channel {
  listKey: readonly unknown[];
  list: () => Promise<SectionRow[]>;
  one: (id: string) => Promise<QuestionDetail>;
  save: (id: string, draft: QuestionDraftInput) => Promise<unknown>;
  otherTests: ((id: string) => Promise<QuestionOnOtherTest[]>) | null;
}

const rowOfDetail = (question: QuestionDetail): SectionRow => ({
  id: question.id,
  preview: previewTextOf(plainTextOf(question.content.en?.stem)),
  difficulty: question.difficulty,
});

function channelOf(seat: SectionSeat, { testId, sectionId }: SectionKey): Channel {
  const assignmentId = seat.row?.id ?? '';
  if (seat.viewer === SECTION_VIEWERS.TYPIST) {
    return {
      listKey: [...QUERY_KEYS.AUTHORING, 'section', assignmentId, 'rows'],
      list: async () =>
        (await sectionQuestions(assignmentId)).map((question) => ({
          id: question.id,
          preview: question.stemPreview,
          difficulty: question.difficulty,
        })),
      one: (id) => api.admin.authoring.detail(id),
      save: (id, draft) => api.admin.authoring.update(id, draft),
      otherTests: null,
    };
  }
  if (seat.viewer === SECTION_VIEWERS.READER) {
    return {
      listKey: [...QUERY_KEYS.PROOFREADING, 'section', testId, sectionId],
      list: async () => (await api.admin.proofreading.forAssignment(assignmentId)).map(rowOfDetail),
      one: (id) => api.admin.proofreading.oneQuestion(assignmentId, id),
      save: (id, draft) => api.admin.proofreading.editQuestion(assignmentId, id, draft),
      otherTests: (id) => api.admin.proofreading.otherTests(assignmentId, id),
    };
  }
  return {
    listKey: [...QUERY_KEYS.PROOFREADING, 'section', testId, sectionId],
    list: async () => (await api.admin.proofreading.forSection(testId, sectionId)).map(rowOfDetail),
    one: (id) => api.admin.proofreading.oneSectionQuestion(testId, sectionId, id),
    save: (id, draft) => api.admin.proofreading.editSectionQuestion(testId, sectionId, id, draft),
    otherTests: (id) => api.admin.proofreading.sectionOtherTests(testId, sectionId, id),
  };
}

/** The section's questions as this viewer is allowed to see them. */
export function useSectionRows(seat: SectionSeat | null, section: SectionKey) {
  const channel = seat ? channelOf(seat, section) : null;
  return useQuery({
    queryKey: channel?.listKey ?? ['none'],
    queryFn: () => channel?.list() ?? Promise.resolve([]),
    enabled: channel !== null,
  });
}

const positionLead = (index: number, count: number) => (
  <span className="text-sm font-semibold tabular-nums">{`Question ${index + 1} of ${count}`}</span>
);

async function settle(queryClient: QueryClient) {
  await Promise.all(
    [QUERY_KEYS.AUTHORING, QUERY_KEYS.PROOFREADING, QUERY_KEYS.ASSIGNMENTS].map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }),
    ),
  );
}

/** The window over the section: each question read and saved through the viewer's own channel. */
export function useSectionSource({
  seat,
  section,
  title,
  rows,
  editable,
  subjectLocked,
}: Readonly<{
  seat: SectionSeat;
  section: SectionKey;
  title: string;
  rows: readonly SectionRow[];
  editable: boolean;
  subjectLocked: boolean;
}>): QuestionsSource {
  const queryClient = useQueryClient();

  return useMemo(() => {
    const channel = channelOf(seat, section);
    const { otherTests } = channel;
    return {
      title,
      keys: rows.map((row) => row.id),
      query: (id) => ({
        queryKey: [...channel.listKey, id, 'held'],
        queryFn: async (): Promise<Held> => {
          const question = await channel.one(id);
          return {
            header: headerOf(question),
            state: stateOf(question),
            stamp: question.updatedAt,
          };
        },
      }),
      lead: (index) => positionLead(index, rows.length),
      subjectLocked,
      checkDuplicates: seat.viewer === SECTION_VIEWERS.TYPIST,
      locked: !editable,
      notice:
        editable && otherTests
          ? (id) => <OtherTestsNotice questionId={id} read={() => otherTests(id)} />
          : undefined,
      save: async (id, held) => {
        // Refused if it moved since this window read it: an edit made elsewhere is not overwritten.
        await channel.save(id, {
          ...toDraft(held.state, held.header),
          expectedUpdatedAt: held.stamp,
        });
        await settle(queryClient);
      },
    };
  }, [seat, section, title, rows, editable, subjectLocked, queryClient]);
}
