import { EXAM_TEMPLATES } from '../../../../lib/constants';
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

/** The polished default: the screen the engine plan shipped, filling every slot. */
export const defaultTemplate: ExamTemplateDefinition = {
  id: EXAM_TEMPLATES.DEFAULT,
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
