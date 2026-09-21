/** Where the slots sit. Both skins compose the same way; the config moves the pieces. */
import { useState } from 'react';
import { FILLS, Tabs, cn } from '@iace/ui';
import {
  BottomBar,
  Header,
  Options,
  Palette,
  PaperWatermark,
  QuestionPanel,
  SectionBar,
  type ExamSlotProps,
} from './slots';
import { PaperPanel, RulesPanel } from './panels';

export function Layout({ view, config }: Readonly<ExamSlotProps>) {
  const onPaper = config.watermark === 'PAPER';
  const [panel, setPanel] = useState<'PAPER' | 'RULES' | null>(null);

  return (
    <>
      {config.watermark === 'SCREEN' ? <PaperWatermark view={view} config={config} /> : null}
      <Header
        view={view}
        config={config}
        onOpenPaper={() => setPanel('PAPER')}
        onOpenRules={() => setPanel('RULES')}
      />

      {/* A COLUMN: without it the section bar and the paper size to their content and spill over the bottom bar. */}
      <Tabs value={view.sectionId} onValueChange={view.openSection} className={FILLS}>
        <SectionBar view={view} config={config} />

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="relative min-h-0 flex-1 overflow-y-auto p-exam">
            {onPaper ? <PaperWatermark view={view} config={config} /> : null}
            <article className="flex min-w-0 flex-col gap-exam-gap">
              <QuestionPanel view={view} config={config} />
              <Options view={view} config={config} />
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
            <Palette view={view} config={config} />
          </aside>
        </div>
      </Tabs>

      <BottomBar view={view} config={config} />

      <PaperPanel
        view={view}
        open={panel === 'PAPER'}
        onOpenChange={(open) => setPanel(open ? 'PAPER' : null)}
      />
      <RulesPanel
        open={panel === 'RULES'}
        onOpenChange={(open) => setPanel(open ? 'RULES' : null)}
      />
    </>
  );
}
