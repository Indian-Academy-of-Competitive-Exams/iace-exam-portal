/**
 * What every printed page carries around its content: the institute's logo behind it, and a footer
 * of our own. A page that declares its own margin boxes is one the browser adds no header or
 * address line to, which is why the footer is here and not left to the print dialog.
 */
import { REPORT_LETTERHEAD } from '@iace/contracts';

const FOOT = 'font: 8pt system-ui, sans-serif; color: gray;';

const LOGO_WIDTH = 88.86;
const LOGO_HEIGHT = 36;
/** `--primary`, written out: a standalone page loads no tokens. */
const LOGO_PLATE = '#bf0d10';
/** The letters of `Brandmark`, traced from Nunito 800: paper has no face to set them in. */
const LOGO_LETTERS =
  'M19.58 26.68Q18.66 26.68 18.18 26.17Q17.7 25.67 17.7 24.76L17.7 11.24Q17.7 10.33 18.18 9.83Q18.66 9.32 19.58 9.32Q20.46 9.32 20.94 9.83Q21.42 10.33 21.42 11.24L21.42 24.76Q21.42 25.67 20.96 26.17Q20.49 26.68 19.58 26.68ZM25.55 26.68Q24.88 26.68 24.46 26.36Q24.04 26.05 23.93 25.52Q23.82 25.0 24.14 24.35L30.28 10.88Q30.66 10.07 31.19 9.7Q31.72 9.32 32.42 9.32Q33.11 9.32 33.64 9.7Q34.17 10.07 34.53 10.88L40.72 24.35Q41.03 25.0 40.95 25.54Q40.86 26.08 40.46 26.38Q40.05 26.68 39.4 26.68Q38.58 26.68 38.14 26.29Q37.7 25.91 37.36 25.09L36.38 22.79L28.46 22.79L27.47 25.09Q27.11 25.93 26.72 26.3Q26.32 26.68 25.55 26.68ZM32.37 13.5L29.68 19.88L35.13 19.88L32.42 13.5L32.37 13.5ZM51.59 26.72Q48.86 26.72 46.91 25.64Q44.97 24.56 43.92 22.61Q42.88 20.65 42.88 17.99Q42.88 16.0 43.47 14.4Q44.06 12.8 45.18 11.66Q46.31 10.52 47.93 9.9Q49.55 9.28 51.59 9.28Q52.79 9.28 54.03 9.58Q55.26 9.88 56.18 10.43Q56.78 10.76 56.99 11.27Q57.21 11.77 57.12 12.28Q57.04 12.78 56.72 13.14Q56.39 13.5 55.91 13.6Q55.43 13.69 54.83 13.38Q54.11 12.95 53.32 12.76Q52.53 12.56 51.71 12.56Q50.1 12.56 49.01 13.2Q47.92 13.84 47.37 15.04Q46.82 16.24 46.82 17.99Q46.82 19.72 47.37 20.94Q47.92 22.16 49.01 22.8Q50.1 23.44 51.71 23.44Q52.48 23.44 53.28 23.24Q54.09 23.05 54.83 22.64Q55.46 22.33 55.95 22.42Q56.44 22.5 56.76 22.85Q57.09 23.2 57.17 23.68Q57.26 24.16 57.06 24.64Q56.87 25.12 56.34 25.45Q55.46 26.05 54.16 26.39Q52.86 26.72 51.59 26.72ZM61.98 26.46Q61.05 26.46 60.54 25.96Q60.04 25.45 60.04 24.52L60.04 11.48Q60.04 10.55 60.54 10.04Q61.05 9.54 61.98 9.54L70.36 9.54Q71.08 9.54 71.45 9.91Q71.82 10.28 71.82 10.98Q71.82 11.7 71.45 12.07Q71.08 12.44 70.36 12.44L63.59 12.44L63.59 16.4L69.81 16.4Q70.55 16.4 70.92 16.78Q71.3 17.15 71.3 17.87Q71.3 18.59 70.92 18.96Q70.55 19.33 69.81 19.33L63.59 19.33L63.59 23.56L70.36 23.56Q71.08 23.56 71.45 23.93Q71.82 24.3 71.82 25.0Q71.82 25.72 71.45 26.09Q71.08 26.46 70.36 26.46L61.98 26.46Z';

/** The lockup as a drawing, so its plate prints whatever "background graphics" is set to; `height` in px fixes its size where no stylesheet can. */
export function logoSvg(height?: number): string {
  const sized =
    height === undefined
      ? ''
      : ` width="${((height * LOGO_WIDTH) / LOGO_HEIGHT).toFixed(2)}" height="${height}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LOGO_WIDTH} ${LOGO_HEIGHT}"${sized} role="img" aria-label="${REPORT_LETTERHEAD}"><rect width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}" rx="6" fill="${LOGO_PLATE}"/><path fill="#fff" d="${LOGO_LETTERS}"/></svg>`;
}

/** The same drawing as an address, for an `img` and for a margin box, which takes nothing else. */
export const logoUrl = (height: number): string =>
  `data:image/svg+xml,${encodeURIComponent(logoSvg(height))}`;

const FOOT_LOGO_HEIGHT = 14;

/** The page rule and the mark's own style. `size` is the sheet and the way it is turned. */
export const printPageCss = (size: string): string => `
  @page {
    size: ${size};
    margin: 12mm 12mm 16mm;
    @top-left { content: ""; }
    @top-right { content: ""; }
    @bottom-left { content: url("${logoUrl(FOOT_LOGO_HEIGHT)}"); }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); ${FOOT} }
  }
  .print-watermark {
    position: fixed; inset: 0; z-index: -1; display: flex; align-items: center;
    justify-content: center; pointer-events: none; user-select: none;
  }
  .print-watermark svg { width: 62%; height: auto; opacity: 0.08; transform: rotate(-30deg); }
`;

/** Fixed, so the printer repeats it on every page. */
export const PRINT_WATERMARK = `<div class="print-watermark" aria-hidden="true">${logoSvg()}</div>`;
