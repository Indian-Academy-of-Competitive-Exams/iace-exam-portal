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

/** The austere baseline: square section buttons, a spelt-out clock beside them, the mark behind all of it. */
const CONFIG = EXAM_TEMPLATE_CONFIG[EXAM_TEMPLATE.SSC_RAILWAYS];

export const sscRailwaysTemplate: ExamTemplateDefinition = {
  id: EXAM_TEMPLATE.SSC_RAILWAYS,
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
