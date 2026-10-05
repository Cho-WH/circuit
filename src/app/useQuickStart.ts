import { channelStorageKey, readChannelStorage } from '../release';
import { useCallback, useState } from 'react';

const legacyKey = 'circuit.quick-start-seen';
export const QUICK_START_SEEN_KEY = channelStorageKey(legacyKey);

export function useQuickStart() {
  const [firstVisit, setFirstVisit] = useState(() => {
    try {
      return readChannelStorage(localStorage, legacyKey, value => value === 'true') !== 'true';
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
