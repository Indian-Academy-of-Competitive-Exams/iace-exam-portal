import { useQuery } from '@tanstack/react-query';
import { contentLanguageOf, type QuestionLanguage } from '@iace/contracts';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/query-keys';

/** The subjects the editor has met, so the rules run here judge them as the server does. */
const met = new Map<string, { language: QuestionLanguage | null; name: string }>();

/** What a subject's questions are written in alone, once its row has been read; null for any other subject. */
export const subjectLanguageOf = (subjectId: string): QuestionLanguage | null =>
  met.get(subjectId)?.language ?? null;

/** The subject's own name, once its row has been read, for the rules to say it by. */
export const subjectNameOf = (subjectId: string): string | null => met.get(subjectId)?.name ?? null;

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
  if (subjectId && subject.data) met.set(subjectId, { language, name: subject.data.name });
  return language;
}
