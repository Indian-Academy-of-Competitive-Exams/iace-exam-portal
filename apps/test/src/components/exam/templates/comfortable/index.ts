import { EXAM_TEMPLATE, EXAM_TEMPLATE_CONFIG } from '@iace/contracts';
import type { ExamTemplateDefinition } from '../../engine/template';
import { Layout } from '../shared/layout';
import {
  BottomBar,
  Header,
  Options,
  Palette,
  PaperWatermark,
  QuestionPanel,
  SectionBar,
  Timer,
} from '../shared/slots';

/** Roomier cells, softer contrast, the clock where a reader looks first. */
const CONFIG = EXAM_TEMPLATE_CONFIG[EXAM_TEMPLATE.COMFORTABLE];

export const comfortableTemplate: ExamTemplateDefinition = {
  id: EXAM_TEMPLATE.COMFORTABLE,
  config: CONFIG,
  slots: {
    Header,
    SectionBar,
    QuestionPanel,
    OptionList: Options,
    Palette,
    BottomBar,
    Timer,
    Watermark: PaperWatermark,
  },
  Layout,
};
