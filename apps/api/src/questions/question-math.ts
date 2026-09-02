import katex from 'katex';
import { firstMathFailure } from '@iace/contracts';

/** Strict here, lenient in the editor: a stored formula is read by a candidate mid-test. */
export function mathErrorIn(latex: string): string | null {
  try {
    katex.renderToString(latex, { throwOnError: true, strict: 'error' });
    return null;
  } catch (error) {
    return (error as Error).message.replace('KaTeX parse error: ', '');
  }
}

/** The first formula in this content that will not render, if there is one. */
export function firstMathError(html: string): { latex: string; message: string } | null {
  return firstMathFailure(html, mathErrorIn);
}
