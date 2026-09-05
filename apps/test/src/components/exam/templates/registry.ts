/** Every skin the exam can wear. The engine never reads this — the paper says which, the screen picks. */
import { EXAM_TEMPLATE, type ExamTemplate } from '@iace/contracts';
import type { ExamTemplateDefinition } from '../engine/template';
import { defaultTemplate } from './default';
import { sscRailwaysTemplate } from './ssc-railways';

const TEMPLATES: Readonly<Record<ExamTemplate, ExamTemplateDefinition>> = {
  [EXAM_TEMPLATE.DEFAULT]: defaultTemplate,
  [EXAM_TEMPLATE.SSC_RAILWAYS]: sscRailwaysTemplate,
};

/** A skin nothing is registered for falls back rather than leaving a candidate on a blank page. */
export const templateFor = (id: ExamTemplate): ExamTemplateDefinition =>
  TEMPLATES[id] ?? defaultTemplate;
