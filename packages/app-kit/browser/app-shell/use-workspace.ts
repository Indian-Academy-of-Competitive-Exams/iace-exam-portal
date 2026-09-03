import { createContext, useContext, useEffect } from 'react';

/** A page whose work IS the window. Declared by the page: only the screen knows. */
export const WorkspaceContext = createContext<((immersive: boolean | null) => void) | null>(null);

/** Runs the page flush, and while `immersive` takes the top bar and rail too. Both come back. */
export function useWorkspace(immersive: boolean): void {
  const setWorkspace = useContext(WorkspaceContext);

  useEffect(() => {
    setWorkspace?.(immersive);
    return () => setWorkspace?.(null);
  }, [setWorkspace, immersive]);
}
