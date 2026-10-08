/** Where the slots sit. Both skins compose the same way; the config moves the pieces. */
import { useState } from 'react';
import { X } from 'lucide-react';
import { EXAM_TEMPLATE } from '@iace/contracts';
import { DESKTOP_QUERY, useMediaQuery } from '@iace/app-kit/browser';
import { Button, FILLS, Sheet, SheetClose, SheetContent, SheetTitle, Tabs, cn } from '@iace/ui';
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

export function Layout({ view, config, onOpenCalculator }: Readonly<ExamSlotProps>) {
  const onPaper = config.watermark === 'PAPER';
  const [panel, setPanel] = useState<'PAPER' | 'RULES' | null>(null);
  // Below the rail's breakpoint the palette would take the paper's own room, so it waits in a drawer.
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [paletteOpen, setPaletteOpen] = useState(false);

  return (
    <>
      {config.watermark === 'SCREEN' ? <PaperWatermark view={view} config={config} /> : null}
      <Header
        view={view}
        config={config}
        onOpenCalculator={onOpenCalculator}
        onOpenPaper={() => setPanel('PAPER')}
        onOpenRules={() => setPanel('RULES')}
      />

      {/* A COLUMN: without it the section bar and the paper size to their content and spill over the bottom bar. */}
      <Tabs value={view.sectionId} onValueChange={view.openSection} className={FILLS}>
        <SectionBar
          view={view}
          config={config}
          onOpenPalette={isDesktop ? undefined : () => setPaletteOpen(true)}
        />

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* The mark sits on this frame, not in the scroller, where it would cover one screenful and scroll away. */}
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <div
              // Keyed, so the next question opens at its top and not at the last one's offset.
              key={view.question?.questionId}
              className="relative min-h-0 flex-1 overflow-y-auto p-exam"
            >
              <article className="flex min-w-0 flex-col gap-exam-gap">
                <QuestionPanel view={view} config={config} />
                <Options view={view} config={config} />
              </article>
            </div>
            {onPaper ? <PaperWatermark view={view} config={config} /> : null}
          </div>

          {isDesktop ? (
            <aside
              className={cn(
                'relative min-h-0 w-72 shrink-0 overflow-y-auto border-exam-border p-exam',
                config.palettePosition === 'LEFT' ? 'order-first border-r' : 'order-last border-l',
              )}
            >
              <Palette view={view} config={config} />
            </aside>
          ) : null}
        </div>
      </Tabs>

      {isDesktop ? null : (
        <Sheet open={paletteOpen} onOpenChange={setPaletteOpen}>
          {/* Portalled out of the shell, so the drawer names the skin itself or its swatches have no colour. */}
          <SheetContent
            side="right"
            aria-describedby={undefined}
            data-exam-template={EXAM_TEMPLATE.DEFAULT.toLowerCase()}
            className="gap-4 overflow-y-auto bg-exam-surface text-exam-ink"
          >
            <div className="flex items-center justify-between">
              <SheetTitle>Question palette</SheetTitle>
              <SheetClose asChild>
                <Button variant="ghost" size="iconSm" aria-label="Close question palette">
                  <X aria-hidden />
                </Button>
              </SheetClose>
            </div>
            <Palette
              view={view}
              config={config}
              onOpen={(questionId) => {
                view.openQuestion(questionId);
                setPaletteOpen(false);
              }}
            />
          </SheetContent>
        </Sheet>
      )}

      <BottomBar view={view} config={config} />

      <PaperPanel
        view={view}
        config={config}
        open={panel === 'PAPER'}
        onOpenChange={(open) => setPanel(open ? 'PAPER' : null)}
      />
      <RulesPanel
        view={view}
        open={panel === 'RULES'}
        onOpenChange={(open) => setPanel(open ? 'RULES' : null)}
      />
    </>
  );
}
