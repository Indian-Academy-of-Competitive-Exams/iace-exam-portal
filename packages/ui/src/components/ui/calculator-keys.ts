/**
 * A four-function calculator's whole behaviour, kept apart from the keypad that
 * draws it so the arithmetic can be tested without a DOM. The keys ARE their
 * labels: one array, no second map to drift from the first.
 */

export const CALCULATOR_OPS = {
  DIVIDE: '÷',
  MULTIPLY: '×',
  SUBTRACT: '−',
  ADD: '+',
} as const;
export type CalculatorOp = (typeof CALCULATOR_OPS)[keyof typeof CALCULATOR_OPS];

export const CALCULATOR_KEYS = {
  CLEAR: 'C',
  BACKSPACE: '⌫',
  EQUALS: '=',
  DECIMAL: '.',
} as const;

/** What a pocket calculator shows instead of Infinity, and it takes Clear to leave. */
export const CALCULATOR_ERROR = 'Error';

/** Twelve, as the government CBT's own calculator caps at. */
const MAX_DIGITS = 12;

const OPS: readonly string[] = Object.values(CALCULATOR_OPS);
const isOp = (key: string): key is CalculatorOp => OPS.includes(key);

interface Pending {
  op: CalculatorOp;
  left: number;
}

export interface CalculatorState {
  display: string;
  pending: Pending | null;
  /** The display is a number being typed, not a result the next operator should fold. */
  entering: boolean;
}

export const CALCULATOR_START: CalculatorState = { display: '0', pending: null, entering: false };

export function pressCalculatorKey(state: CalculatorState, key: string): CalculatorState {
  if (key === CALCULATOR_KEYS.CLEAR) return CALCULATOR_START;
  if (state.display === CALCULATOR_ERROR) return state;
  if (key >= '0' && key <= '9') return typeDigit(state, key);
  if (key === CALCULATOR_KEYS.DECIMAL) return typeDecimal(state);
  if (key === CALCULATOR_KEYS.BACKSPACE) return erase(state);
  if (key === CALCULATOR_KEYS.EQUALS) return settle(state);
  return isOp(key) ? hold(state, key) : state;
}

function typeDigit(state: CalculatorState, digit: string): CalculatorState {
  if (!state.entering) return { ...state, display: digit, entering: true };
  if (state.display.replace(/\D/g, '').length >= MAX_DIGITS) return state;
  return { ...state, display: state.display === '0' ? digit : state.display + digit };
}

function typeDecimal(state: CalculatorState): CalculatorState {
  if (!state.entering) return { ...state, display: '0.', entering: true };
  return state.display.includes('.') ? state : { ...state, display: `${state.display}.` };
}

/** Only ever backs out of something being TYPED: a result is cleared, never nibbled. */
function erase(state: CalculatorState): CalculatorState {
  if (!state.entering) return state;
  const shorter = state.display.slice(0, -1);
  return { ...state, display: shorter === '' ? '0' : shorter };
}

/** An operator on a result replaces the pending one, as every calculator does. */
function hold(state: CalculatorState, op: CalculatorOp): CalculatorState {
  if (state.pending && !state.entering) return { ...state, pending: { ...state.pending, op } };
  const folded = state.pending ? fold(state.pending, Number(state.display)) : Number(state.display);
  if (!Number.isFinite(folded)) return { ...CALCULATOR_START, display: CALCULATOR_ERROR };
  return { display: show(folded), pending: { op, left: folded }, entering: false };
}

function settle(state: CalculatorState): CalculatorState {
  if (!state.pending) return { ...state, entering: false };
  const result = fold(state.pending, Number(state.display));
  if (!Number.isFinite(result)) return { ...CALCULATOR_START, display: CALCULATOR_ERROR };
  return { display: show(result), pending: null, entering: false };
}

function fold({ op, left }: Pending, right: number): number {
  if (op === CALCULATOR_OPS.ADD) return left + right;
  if (op === CALCULATOR_OPS.SUBTRACT) return left - right;
  if (op === CALCULATOR_OPS.MULTIPLY) return left * right;
  return left / right;
}

/** 0.1 + 0.2 must read 0.3: a float's own string is the one place this can be wrong. */
function show(value: number): string {
  return String(Number(value.toPrecision(12)));
}
