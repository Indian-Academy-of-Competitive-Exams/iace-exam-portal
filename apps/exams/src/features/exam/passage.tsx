import type { passagesOf } from '@iace/app-kit';
import { RichContent } from '@iace/ui';

/** What a question is asked about. Every skin draws its own pane; this is only what goes in it. */
export function Passage({
  passages,
  className,
}: Readonly<{ passages: ReturnType<typeof passagesOf>; className?: string }>) {
  return (
    <>
      {passages.map((passage) => (
        <RichContent
          key={passage.language}
          lang={passage.language.toLowerCase()}
          className={className}
          html={passage.html}
        />
      ))}
    </>
  );
}
