/**
 * What every printed page carries around its content: the institute's mark behind it, and a footer
 * of our own. A page that declares its own margin boxes is one the browser adds no header or
 * address line to, which is why the footer is here and not left to the print dialog.
 */
import { REPORT_LETTERHEAD } from '@iace/contracts';

const FOOT = 'font: 8pt system-ui, sans-serif; color: gray;';

/** The page rule and the mark's own style. `size` is the sheet and the way it is turned. */
export const printPageCss = (size: string): string => `
  @page {
    size: ${size};
    margin: 12mm 12mm 16mm;
    @top-left { content: ""; }
    @top-right { content: ""; }
    @bottom-left { content: "${REPORT_LETTERHEAD}"; ${FOOT} }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); ${FOOT} }
  }
  .print-watermark {
    position: fixed; inset: 0; z-index: -1; display: flex; align-items: center;
    justify-content: center; font: 800 140pt/1 system-ui, sans-serif; letter-spacing: 0.04em;
    color: rgb(0 0 0 / 0.05); transform: rotate(-30deg); pointer-events: none; user-select: none;
  }
`;

/** Fixed, so the printer repeats it on every page; text, so it prints whatever "background graphics" is set to. */
export const PRINT_WATERMARK = `<div class="print-watermark" aria-hidden="true">${REPORT_LETTERHEAD}</div>`;
