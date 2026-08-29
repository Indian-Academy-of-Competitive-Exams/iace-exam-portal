import { EXAM_TEMPLATE_CONFIG, type ExamTemplate, type ExamTemplateConfig } from '@iace/contracts';

/** A miniature of the sitting, laid out from the skin's OWN config so it cannot describe another. */

function Clock({ config }: Readonly<{ config: ExamTemplateConfig }>) {
  return (
    <span className="flex items-center gap-0.5 rounded-sm border border-exam-timer-border bg-exam-timer-bg px-1 py-px text-[6px] leading-none text-exam-timer-ink">
      {config.timerFormat === 'LABELLED' ? <span>Time left</span> : null}
      <span className="font-medium">59:12</span>
    </span>
  );
}

const SECTION_CHIP = {
  TABS: {
    frame: 'border-b-2 px-1 pb-px',
    on: 'border-exam-current text-exam-ink',
    off: 'border-transparent text-exam-section-ink',
  },
  BUTTONS: {
    frame: 'border px-1 py-px',
    on: 'border-exam-border bg-exam-section-active text-exam-section-active-ink',
    off: 'border-exam-border bg-exam-surface-2 text-exam-section-ink',
  },
} as const;

function Sections({ config }: Readonly<{ config: ExamTemplateConfig }>) {
  const chip = SECTION_CHIP[config.sectionSwitch];
  return (
    <span className="flex items-end gap-1">
      {[true, false].map((active) => (
        <span
          key={String(active)}
          className={`text-[6px] leading-none ${chip.frame} ${active ? chip.on : chip.off}`}
        >
          {active ? 'Sec A' : 'Sec B'}
        </span>
      ))}
    </span>
  );
}

const PALETTE_STATES = [
  'bg-exam-answered',
  'bg-exam-notanswered',
  'bg-exam-marked',
  'bg-exam-notvisited',
  'bg-exam-notvisited',
  'bg-exam-notvisited',
] as const;

function Palette() {
  return (
    <span className="grid w-8 shrink-0 grid-cols-3 content-start gap-px bg-exam-surface-2 p-1">
      {PALETTE_STATES.map((tone, index) => (
        <span key={tone + String(index)} className={`size-1.5 rounded-[1px] ${tone}`} />
      ))}
    </span>
  );
}

export function ExamTemplatePreview({ template }: Readonly<{ template: ExamTemplate }>) {
  const config = EXAM_TEMPLATE_CONFIG[template];
  const palette = <Palette />;

  return (
    <span
      aria-hidden
      data-exam-template={template.toLowerCase()}
      className="relative block w-[260px] max-w-full overflow-hidden rounded border border-exam-border bg-exam-surface"
    >
      {config.watermark === 'SCREEN' ? (
        <span className="pointer-events-none absolute inset-0 grid place-items-center text-[10px] font-bold uppercase tracking-wide text-exam-ink opacity-[0.06]">
          IACE
        </span>
      ) : null}

      <span className="flex items-center justify-between border-b border-exam-border px-1.5 py-1">
        <span className="h-1 w-5 rounded-full bg-exam-ink-muted opacity-60" />
        {config.timerPosition === 'HEADER' ? <Clock config={config} /> : null}
      </span>

      <span className="flex items-center justify-between gap-1 border-b border-exam-border px-1.5 py-1">
        <Sections config={config} />
        {config.timerPosition === 'SECTION_BAR' ? <Clock config={config} /> : null}
      </span>

      <span className="flex h-[52px]">
        {config.palettePosition === 'LEFT' ? palette : null}
        <span className="relative flex-1 space-y-1 p-1.5">
          {config.watermark === 'PAPER' ? (
            <span className="pointer-events-none absolute inset-0 grid place-items-center text-[9px] font-bold uppercase tracking-wide text-exam-ink opacity-[0.06]">
              IACE
            </span>
          ) : null}
          <span className="block h-1 w-2/3 rounded-full bg-exam-ink opacity-40" />
          <span className="block h-1 w-1/2 rounded-full bg-exam-ink-muted opacity-30" />
          {[0, 1].map((row) => (
            <span
              key={row}
              className="block h-2 rounded-sm border border-exam-option-border bg-exam-option"
            />
          ))}
        </span>
        {config.palettePosition === 'RIGHT' ? palette : null}
      </span>
    </span>
  );
}
