/**
 * What a candidate reads before the clock starts, as one value both skins take. Nothing
 * here starts the paper — `begin` is the only thing that does, and it is a click away so
 * the browser will still grant full screen for it.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LANGUAGE_MODE,
  NAVIGATION_POLICY,
  type ExamBrief,
  type LanguageCode,
} from '@iace/contracts';
import { ROUTES } from '../../../lib/constants';

export const INSTRUCTION_STEPS = ['GENERAL', 'PAPER'] as const;
export type InstructionStep = (typeof INSTRUCTION_STEPS)[number];

export interface InstructionsView {
  brief: ExamBrief;
  step: InstructionStep;
  stepIndex: number;
  next: () => void;
  back: () => void;
  goTo: (step: InstructionStep) => void;
  /** A DUAL paper shows both languages, so there is nothing to choose and nothing to gate on. */
  dual: boolean;
  /** A seat left is closed for good, so the rules a candidate is taught here are different ones. */
  forwardOnly: boolean;
  language: LanguageCode | '';
  chooseLanguage: (code: LanguageCode) => void;
  declared: boolean;
  declare: (value: boolean) => void;
  ready: boolean;
  begin: () => void;
}

export function useInstructions(
  brief: ExamBrief,
  onBegin: (languages: readonly LanguageCode[]) => void,
): InstructionsView {
  const navigate = useNavigate();
  const [stepIndex, setStepIndex] = useState(0);
  const [declared, setDeclared] = useState(false);
  const [language, setLanguage] = useState<LanguageCode | ''>('');

  const dual = brief.languageMode === LANGUAGE_MODE.DUAL;
  // A paper offering one language has nothing to choose, so it arrives chosen rather than skippable.
  const chosen = language || (brief.languages.length === 1 ? (brief.languages[0] ?? '') : '');
  const ready = declared && (dual || chosen !== '');

  return {
    brief,
    forwardOnly: brief.navigation === NAVIGATION_POLICY.FORWARD_ONLY,
    step: INSTRUCTION_STEPS[stepIndex] ?? 'GENERAL',
    stepIndex,
    next: () => setStepIndex((at) => Math.min(at + 1, INSTRUCTION_STEPS.length - 1)),
    goTo: (step) => setStepIndex(INSTRUCTION_STEPS.indexOf(step)),
    back: () =>
      stepIndex === 0 ? navigate(ROUTES.TEST_ABOUT(brief.testId)) : setStepIndex(stepIndex - 1),
    dual,
    language: chosen,
    chooseLanguage: setLanguage,
    declared,
    declare: setDeclared,
    ready,
    begin: () => onBegin(dual ? brief.languages : [chosen as LanguageCode]),
  };
}
