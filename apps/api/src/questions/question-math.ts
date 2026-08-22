import katex from 'katex';

/** Editor output: `<span data-type="inline-math" data-latex="\\frac{a}{b}">`. */
const MATH_LATEX = /data-latex="([^"]*)"/gi;

/** Attribute values arrive html-escaped, and KaTeX must parse the LaTeX, not the escaping. */
function unescape(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replaceAll('&amp;', '&');
}

/** Every formula a piece of content carries, in the order they appear. */
export function latexIn(html: string): string[] {
  return [...html.matchAll(MATH_LATEX)].map((match) => unescape(match[1] ?? ''));
}

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
  for (const latex of latexIn(html)) {
    const message = mathErrorIn(latex);
    if (message) return { latex, message };
  }
  return null;
}
