import { useEffect, useRef, useState } from 'react';

/** Open while pointed at, shut a beat after: crossing the gap to a row's popover must not close it. */
export function useHoverOpen(closeDelayMs: number) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const close = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };

  return {
    open,
    close,
    onPointerEnter: () => {
      clearTimeout(timer.current);
      setOpen(true);
    },
    onPointerLeave: () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setOpen(false), closeDelayMs);
    },
  };
}
