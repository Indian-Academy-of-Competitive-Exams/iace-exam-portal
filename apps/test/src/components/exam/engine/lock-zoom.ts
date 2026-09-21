/**
 * A sitting is drawn at one scale for everyone, so the page does not zoom under it.
 * Pinch, ctrl-wheel and the keyboard shortcuts are all refused; the browser's own
 * menu zoom is not cancellable and stays the one way out.
 */
import { useEffect } from 'react';

const ZOOM_KEYS: ReadonlySet<string> = new Set(['+', '=', '-', '_', '0']);

export function useLockedZoom(): void {
  useEffect(() => {
    const refuse = (event: Event) => event.preventDefault();

    const refuseWheelZoom = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) event.preventDefault();
    };

    const refuseKeyZoom = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && ZOOM_KEYS.has(event.key)) event.preventDefault();
    };

    window.addEventListener('wheel', refuseWheelZoom, { passive: false });
    window.addEventListener('keydown', refuseKeyZoom);
    document.addEventListener('gesturestart', refuse);
    document.addEventListener('gesturechange', refuse);
    document.addEventListener('gestureend', refuse);

    return () => {
      window.removeEventListener('wheel', refuseWheelZoom);
      window.removeEventListener('keydown', refuseKeyZoom);
      document.removeEventListener('gesturestart', refuse);
      document.removeEventListener('gesturechange', refuse);
      document.removeEventListener('gestureend', refuse);
    };
  }, []);
}
