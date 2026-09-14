import katex from 'katex';

/** Strict here, lenient in the editor: a stored formula is read by a candidate mid-test. */
export function mathErrorIn(latex: string): string | null {
  try {
    katex.renderToString(latex, { throwOnError: true, strict: 'error' });
    return null;
  } catch (error) {
    return (error as Error).message.replace('KaTeX parse error: ', '');
  }
}
