/** Where the slots sit. Both skins compose the same way; the config moves the pieces. */
import { useState } from 'react';
import { X } from 'lucide-react';
import { EXAM_TEMPLATE } from '@iace/contracts';
import { passagesOf, PAUSE_SAYS, usePause } from '@iace/app-kit';
import { DESKTOP_QUERY, useMediaQuery } from '@iace/app-kit/browser';
import {
  Button,
  ConfirmDialog,
  FILLS,
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  Tabs,
  cn,
} from '@iace/ui';
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
import { Passage } from '../../passage';
import { ScrollPane } from '../../scroll-pane';
import { isTypingQuestion } from '../../../typing/typing-figures';
import { ExamTyping } from './exam-typing';
import { PaperPanel, RulesPanel } from './panels';

export function Layout({ view, config, onOpenCalculator, onPause }: Readonly<ExamSlotProps>) {
  const onPaper = config.watermark === 'PAPER';
  const [panel, setPanel] = useState<'PAPER' | 'RULES' | null>(null);
  // Below the rail's breakpoint the palette would take the paper's own room, so it waits in a drawer.
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const pause = usePause(onPause);
  const passages = view.question
    ? passagesOf(view.question.content, view.languages, view.languageMode)
    : [];

  return (
    <>
      {config.watermark === 'SCREEN' ? <PaperWatermark view={view} config={config} /> : null}
      <Header
        view={view}
        config={config}
        onOpenCalculator={onOpenCalculator}
        onPause={onPause ? pause.ask : undefined}
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
              // Keyed, so the next question opens both panes at their top and not at the last one's offset.
              key={view.question?.questionId}
              className="flex min-h-0 flex-1 flex-col md:flex-row"
            >
              {passages.length > 0 ? (
                <ScrollPane
                  keys
                  wheel
                  className="max-h-[40%] shrink-0 border-b border-exam-border md:max-h-none md:w-[55%] md:border-b-0 md:border-r"
                >
                  <div className="flex flex-col gap-exam-gap p-exam">
                    <Passage
                      passages={passages}
                      className="text-sm leading-relaxed text-exam-ink"
                    />
                  </div>
                </ScrollPane>
              ) : null}
              {isTypingQuestion(view.question) ? (
                <ExamTyping view={view} />
              ) : (
                <ScrollPane keys wheel className="min-h-0 min-w-0 flex-1">
                  <article className="flex min-w-0 flex-col gap-exam-gap p-exam">
                    <QuestionPanel view={view} config={config} />
                    <Options view={view} config={config} />
                  </article>
                </ScrollPane>
              )}
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

      {onPause ? (
        <ConfirmDialog
          open={pause.asking}
          onOpenChange={(open) => !open && pause.cancel()}
          title={PAUSE_SAYS.title}
          description={pause.says}
          confirmLabel={PAUSE_SAYS.confirm}
          loading={pause.pending}
          onConfirm={pause.confirm}
        />
      ) : null}

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
