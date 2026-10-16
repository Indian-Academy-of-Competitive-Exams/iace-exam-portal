import { useEffect, useState } from 'react';

const SEARCH_SETTLE_MS = 300;

/** What was typed once the typing pauses, so a word asks the server once rather than per letter. */
export function useSettled(typed: string): string {
  const [settled, setSettled] = useState(typed);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(typed), SEARCH_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [typed]);
  return settled;
}
