import { useCallback } from 'react';
import { useLeaveGuard } from '@iace/app-kit/browser';

const nothingToSend = () => undefined;

/** The browser's own prompt before a reload or a closed tab drops unsaved work; in-app moves ask for themselves. */
export function useUnsavedPrompt(unsaved: boolean) {
  useLeaveGuard(
    useCallback(() => unsaved, [unsaved]),
    nothingToSend,
  );
}
