import { useQuery } from '@tanstack/react-query';
import { contentLanguageOf, type QuestionLanguage } from '@iace/contracts';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/query-keys';

/** The language subjects the editor has met, so the rules run here judge them as the server does. */
const languageOf = new Map<string, QuestionLanguage | null>();

/** What a subject's questions are written in alone, once its row has been read; null for any other subject. */
export const subjectLanguageOf = (subjectId: string): QuestionLanguage | null =>
  languageOf.get(subjectId) ?? null;

/** Reads the chosen subject's row once, so a Hindi Comprehension question is not asked for English. */
export function useSubjectLanguage(subjectId: string | undefined): QuestionLanguage | null {
  const subject = useQuery({
    queryKey: [...QUERY_KEYS.SUBJECTS, 'language', subjectId ?? ''],
    queryFn: async () =>
      (await api.admin.taxonomy.listSubjects({ id: [subjectId ?? ''] })).items[0],
    enabled: Boolean(subjectId),
    staleTime: Infinity,
  });
  const code = subject.data?.language ?? null;
  const language = code === null ? null : contentLanguageOf(code);
  if (subjectId && subject.data) languageOf.set(subjectId, language);
  return language;
}
