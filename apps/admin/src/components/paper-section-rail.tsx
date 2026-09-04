import type { ReactNode } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { BaseConfigSection } from '@iace/contracts';
import {
  Badge,
  Button,
  cn,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TruncatedText,
} from '@iace/ui';

/** The paper's sections down the side: which one is open, and how full each one is. */

const ROW = [
  'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-medium',
  'transition-colors focus-visible:shadow-focus focus-visible:outline-none',
].join(' ');

const ROW_IDLE = 'text-muted-foreground hover:bg-muted hover:text-foreground';
const ROW_ACTIVE = 'bg-primary-subtle text-primary-ink';

/** Collapsed, the row IS the glyph: square and round, so the hover is a disc around it. */
const ROW_RAIL = 'mx-auto size-[--nav-item-h] justify-center rounded-full px-0 py-0';

/** In the rail a row is a bare number, so its name has to arrive on hover and on focus. */
function RailTooltip({
  label,
  collapsed,
  children,
}: Readonly<{ label: string; collapsed: boolean; children: ReactNode }>) {
  if (!collapsed) return <>{children}</>;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function PaperSectionRail({
  sections,
  held,
  openSectionId,
  collapsed,
  onOpen,
  onCollapsedChange,
}: Readonly<{
  sections: readonly BaseConfigSection[];
  /** How many questions each section already holds, by `BaseConfigSection.id`. */
  held: ReadonlyMap<string, number>;
  openSectionId: string;
  collapsed: boolean;
  onOpen: (sectionId: string) => void;
  onCollapsedChange: (collapsed: boolean) => void;
}>) {
  const toggleLabel = collapsed ? 'Expand sections' : 'Collapse sections';
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <div
      className={cn(
        'flex min-h-0 shrink-0 flex-col gap-2 border-r border-border',
        // The rail token is sized for a disc plus air; a row's own width would clip it.
        collapsed ? 'w-[--sidebar-w-rail] px-1' : 'w-56 pr-3',
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="iconSm"
            className={cn('shrink-0', collapsed ? 'self-center' : 'self-end')}
            onClick={() => onCollapsedChange(!collapsed)}
          >
            <ToggleIcon aria-hidden />
            <span className="sr-only">{toggleLabel}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{toggleLabel}</TooltipContent>
      </Tooltip>

      {/* `relative`, because an sr-only label under a static scroller escapes it and grows the page. */}
      <ul
        aria-label="Paper sections"
        className="relative min-h-0 flex-1 space-y-0.5 overflow-y-auto"
      >
        {sections.map((section, index) => {
          const count = held.get(section.id) ?? 0;
          const short = count < section.questionCount;
          const tally = `${count} of ${section.questionCount}`;
          const open = section.id === openSectionId;

          return (
            <li key={section.id}>
              <RailTooltip label={`${section.name} · ${tally}`} collapsed={collapsed}>
                <button
                  type="button"
                  aria-current={open ? 'true' : undefined}
                  onClick={() => onOpen(section.id)}
                  className={cn(ROW, open ? ROW_ACTIVE : ROW_IDLE, collapsed && ROW_RAIL)}
                >
                  {collapsed ? (
                    <>
                      <span aria-hidden>{index + 1}</span>
                      <span className="sr-only">{`${section.name} · ${tally}`}</span>
                    </>
                  ) : (
                    <>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <TruncatedText>{section.name}</TruncatedText>
                        <span className="text-xs font-normal">{tally}</span>
                      </span>
                      <Badge variant={short ? 'warning' : 'success'}>
                        {short ? 'Short' : 'Full'}
                      </Badge>
                    </>
                  )}
                </button>
              </RailTooltip>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
