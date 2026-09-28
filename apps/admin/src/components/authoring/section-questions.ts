import { PAGE_SIZE_MAX, type QuestionSummary } from '@iace/contracts';
import { api } from '../../lib/api';

/** Every question written for a section, oldest first, however many pages that takes. */
export async function sectionQuestions(assignmentId: string): Promise<QuestionSummary[]> {
  const all: QuestionSummary[] = [];
  for (let page = 1; ; page += 1) {
    const read = await api.admin.authoring.history({
      assignmentId: [assignmentId],
      page,
      pageSize: PAGE_SIZE_MAX,
    });
    all.push(...read.items);
    if (all.length >= read.total || read.items.length === 0) return all.reverse();
  }
}
