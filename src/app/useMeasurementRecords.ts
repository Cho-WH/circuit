import { useEffect, useState } from 'react';
import { loadMeasurementNotebook, saveMeasurementNotebook } from '../persistence';

export function useMeasurementRecords() {
  const [loaded] = useState(() => loadMeasurementNotebook());
  const [entries, setEntries] = useState(loaded.entries);
  const [storageWarning, setStorageWarning] = useState(loaded.warning ?? '');
  useEffect(() => {
    // A failed read must not replace the stored history with an empty notebook.
    if (entries === loaded.entries) return;
    setStorageWarning(
      saveMeasurementNotebook(entries)
        ? ''
        : '기록을 이 기기에 저장하지 못했어요. 표를 복사하거나 CSV로 저장해 주세요.',
    );
  }, [entries, loaded]);
  return { entries, setEntries, storageWarning };
}
