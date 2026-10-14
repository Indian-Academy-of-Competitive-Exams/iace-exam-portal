import { useEffect } from 'react';
import { Keyboard, ListChecks, Maximize2, Minimize2, X } from 'lucide-react';
import { LANGUAGE_LABELS, type QuestionLanguage } from '@iace/contracts';
import { Button, Tooltip, TooltipContent, TooltipTrigger, cn } from '@iace/ui';
import { TOUR_TARGETS } from '../../lib/tours';
import { SCRIPT_OF } from './question-scaffold';
import { type PanelPosition, type WorkspacePanel } from './workspace-types';

/** The progress panel over the cards' right edge, like the app shell's menu: nothing moves under it. */
export function SlideOver({
  panel,
  open,
  onClose,
  ...position
}: Readonly<PanelPosition & { panel: WorkspacePanel; open: boolean; onClose: () => void }>) {
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open, onClose]);

  return (
    <aside
      aria-label={panel.label}
      aria-hidden={!open}
      className={cn(
        'absolute inset-y-0 right-0 z-20 flex w-80 max-w-full flex-col border-l border-border bg-surface shadow-lg transition-transform duration-200',
        open ? 'translate-x-0' : 'pointer-events-none translate-x-full',
      )}
    >
      <div className="flex flex-none items-center justify-between border-b border-border px-4 py-2">
        <h2 className="text-sm font-semibold">{panel.label}</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Close ${panel.label}`}
          onClick={onClose}
        >
          <X aria-hidden />
        </Button>
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto p-4">
        <PanelBody panel={panel} {...position} />
      </div>
    </aside>
  );
}

function PanelBody({ panel, ...position }: Readonly<PanelPosition & { panel: WorkspacePanel }>) {
  return panel.render(position);
}

/** The header's right end: how letters are typed, progress, full screen. */
export function HeaderTools({
  language,
  romanised,
  editable,
  immersive,
  panelLabel,
  panelOpen,
  onRomanised,
  onPanel,
  onFocus,
}: Readonly<{
  language: QuestionLanguage;
  romanised: boolean;
  editable: boolean;
  immersive: boolean;
  panelLabel: string | null;
  panelOpen: boolean;
  onRomanised: () => void;
  onPanel: () => void;
  onFocus: () => void;
}>) {
  return (
    <div className="flex flex-none items-center gap-2">
      {editable && SCRIPT_OF[language] ? (
        <IconAction
          label={
            romanised
              ? `Typing dhanyavaad writes it in ${LANGUAGE_LABELS[language]}`
              : 'Roman letters stay as they are typed'
          }
          pressed={romanised}
          onClick={onRomanised}
        >
          <Keyboard aria-hidden />
        </IconAction>
      ) : null}
      {panelLabel ? (
        <span data-tour={TOUR_TARGETS.AUTHORING_PROGRESS}>
          <IconAction label={panelLabel} pressed={panelOpen} onClick={onPanel}>
            <ListChecks aria-hidden />
          </IconAction>
        </span>
      ) : null}
      <IconAction label={immersive ? 'Leave full screen' : 'Full screen'} onClick={onFocus}>
        {immersive ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
      </IconAction>
    </div>
  );
}

function IconAction({
  label,
  pressed,
  onClick,
  children,
}: Readonly<{
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={pressed ? 'default' : 'ghost'}
          size="icon"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
