import { EXAM_TEMPLATE } from '@iace/contracts';
import type { ExamTemplateConfig, ExamTemplateDefinition } from '../../engine/template';
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
const CONFIG: ExamTemplateConfig = {
  timerPosition: 'SECTION_BAR',
  timerFormat: 'LABELLED',
  palettePosition: 'LEFT',
  sectionSwitch: 'BUTTONS',
  watermark: 'SCREEN',
};

export const strictTemplate: ExamTemplateDefinition = {
  id: EXAM_TEMPLATE.STRICT,
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
