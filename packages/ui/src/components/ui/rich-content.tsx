/**
 * Authored content, read-only: the same markup the editor produced, shown to
 * whoever reads it. It carries `rich-content` like the editor does, so a table
 * looks the same to the author and to the candidate from one stylesheet.
 */
import * as React from 'react';
import { cn } from '../../lib/utils';
import { richHtml } from '../../lib/rich-html';

export interface RichContentProps {
  html: string;
  /** Tags the content for `:lang()`, which is what gives Telugu its taller line box. */
  lang?: string;
  className?: string;
}

export function RichContent({ html, lang, className }: Readonly<RichContentProps>) {
  const safe = React.useMemo(() => richHtml(html), [html]);

  return (
    <div
      lang={lang}
      className={cn('rich-content', className)}
      // `richHtml` is the only producer: whitelisted markup, and equations already drawn.
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}
