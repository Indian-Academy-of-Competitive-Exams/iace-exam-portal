/**
 * The contract a skin fills in. Every slot is handed the same view, so what a
 * template can change is how the sitting LOOKS — never what it does, what it
 * saves, or what the clock says.
 */
import type { ComponentType } from 'react';
import type { ExamView } from './exam-view';

export interface ExamSlotProps {
  view: ExamView;
}

export type ExamSlot = ComponentType<Readonly<ExamSlotProps>>;

export interface ExamSlots {
  Header: ExamSlot;
  SectionBar: ExamSlot;
  QuestionPanel: ExamSlot;
  OptionList: ExamSlot;
  Palette: ExamSlot;
  BottomBar: ExamSlot;
  Timer: ExamSlot;
  Watermark: ExamSlot;
}

export interface ExamLayoutProps extends ExamSlotProps {
  slots: ExamSlots;
}

export interface ExamTemplateDefinition {
  /** Also the `data-exam-template` value, which is what scopes the skin's tokens. */
  id: string;
  slots: ExamSlots;
  Layout: ComponentType<Readonly<ExamLayoutProps>>;
}
