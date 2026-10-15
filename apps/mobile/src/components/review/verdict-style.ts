import { VERDICT, type Verdict } from '@iace/app-kit';

interface VerdictStyle {
  label: string;
  fill: string;
  edge: string;
  ink: string;
}

/** The three verdicts, their names and their colours — the only source of either. */
export const VERDICT_STYLE: Readonly<Record<Verdict, VerdictStyle>> = {
  [VERDICT.RIGHT]: {
    label: 'Correct',
    fill: 'bg-success-subtle',
    edge: 'border-success',
    ink: 'text-success-ink',
  },
  [VERDICT.WRONG]: {
    label: 'Incorrect',
    fill: 'bg-destructive-subtle',
    edge: 'border-destructive',
    ink: 'text-destructive',
  },
  [VERDICT.LEFT]: {
    label: 'Unattempted',
    fill: 'bg-muted',
    edge: 'border-border',
    ink: 'text-muted-foreground',
  },
};
