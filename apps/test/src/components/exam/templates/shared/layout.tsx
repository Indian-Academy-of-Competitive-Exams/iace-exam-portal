/** Where the slots sit. Both skins compose the same way; the config moves the pieces. */
import { Tabs, cn } from '@iace/ui';
import type { ExamLayoutProps } from '../../engine/template';

export function Layout({ view, config, slots }: Readonly<ExamLayoutProps>) {
  const onPaper = config.watermark === 'PAPER';

  return (
    <>
      {config.watermark === 'SCREEN' ? <slots.Watermark view={view} config={config} /> : null}
      <slots.Header view={view} config={config} />

      <Tabs value={view.sectionId} onValueChange={view.openSection} className="min-h-0 flex-1">
        <slots.SectionBar view={view} config={config} />

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="relative min-h-0 flex-1 overflow-y-auto p-exam">
            {onPaper ? <slots.Watermark view={view} config={config} /> : null}
            <article className="flex min-w-0 flex-col gap-exam-gap">
              <slots.QuestionPanel view={view} config={config} />
              <slots.OptionList view={view} config={config} />
            </article>
          </div>

          <aside
            className={cn(
              'shrink-0 border-t border-exam-border p-exam lg:w-72 lg:border-t-0',
              config.palettePosition === 'LEFT'
                ? 'lg:order-first lg:border-r'
                : 'lg:order-last lg:border-l',
            )}
          >
            <slots.Palette view={view} config={config} />
          </aside>
        </div>
      </Tabs>

      <slots.BottomBar view={view} config={config} />
    </>
  );
}
