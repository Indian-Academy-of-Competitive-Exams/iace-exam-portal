/** Every skin the exam can wear. The engine never reads this — the screen picks, the engine renders. */
import { EXAM_TEMPLATES } from '../../../lib/constants';
import type { ExamTemplateDefinition } from '../engine/template';
import { defaultTemplate } from './default';

const TEMPLATES: Readonly<Record<string, ExamTemplateDefinition>> = {
  [EXAM_TEMPLATES.DEFAULT]: defaultTemplate,
};

/** An id nothing is registered for falls back rather than leaving a candidate on a blank page. */
export const templateFor = (id: string): ExamTemplateDefinition => TEMPLATES[id] ?? defaultTemplate;
