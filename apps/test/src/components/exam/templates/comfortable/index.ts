import { EXAM_TEMPLATE } from '@iace/contracts';
import type { ExamTemplateDefinition } from '../../engine/template';
import {
  BottomBar,
  Header,
  Layout,
  Options,
  Palette,
  PaperWatermark,
  QuestionPanel,
  SectionBar,
  Timer,
} from './slots';

/** The polished default: roomier cells, softer contrast, the screen the engine plan shipped. */
export const comfortableTemplate: ExamTemplateDefinition = {
  id: EXAM_TEMPLATE.COMFORTABLE,
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
