import { useCallback, useState } from 'react';

export const QUICK_START_SEEN_KEY = 'circuit.quick-start-seen';

export function useQuickStart() {
  const [firstVisit, setFirstVisit] = useState(() => {
    try {
      return localStorage.getItem(QUICK_START_SEEN_KEY) !== 'true';
    } catch {
      return true;
    }
  });
  const [help, setHelp] = useState(firstVisit);
  const showHelp = useCallback(() => setHelp(true), []);
  const closeHelp = useCallback(() => {
    try {
      localStorage.setItem(QUICK_START_SEEN_KEY, 'true');
    } catch {
      // Storage restrictions must never prevent entering the editor.
    }
    setFirstVisit(false);
    setHelp(false);
  }, []);
  return { help, firstVisit, showHelp, closeHelp };
}
