/** Every skin the exam can wear. The engine never reads this — the paper says which, the screen picks. */
import { EXAM_TEMPLATE, type ExamTemplate } from '@iace/contracts';
import type { ExamTemplateDefinition } from '../engine/template';
import { comfortableTemplate } from './comfortable';
import { strictTemplate } from './strict';

const TEMPLATES: Readonly<Record<ExamTemplate, ExamTemplateDefinition>> = {
  [EXAM_TEMPLATE.COMFORTABLE]: comfortableTemplate,
  [EXAM_TEMPLATE.STRICT]: strictTemplate,
};

/** A skin nothing is registered for falls back rather than leaving a candidate on a blank page. */
export const templateFor = (id: ExamTemplate): ExamTemplateDefinition =>
  TEMPLATES[id] ?? comfortableTemplate;
