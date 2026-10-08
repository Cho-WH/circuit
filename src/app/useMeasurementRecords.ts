import { useEffect, useReducer, useState, type SetStateAction } from 'react';
import {
  loadMeasurementNotebook,
  saveMeasurementNotebook,
  type MeasurementEntry,
} from '../persistence';

type RecordState = {
  entries: MeasurementEntry[];
  deleted: { entries: MeasurementEntry[]; order: string[] } | null;
};
type RecordAction =
  | { type: 'update'; value: SetStateAction<MeasurementEntry[]> }
  | { type: 'delete'; id?: string }
  | { type: 'restore' };

function recordsReducer(state: RecordState, action: RecordAction): RecordState {
  if (action.type === 'update')
    return {
      ...state,
      entries: typeof action.value === 'function' ? action.value(state.entries) : action.value,
    };
  if (action.type === 'delete') {
    const removed = state.entries.filter(
      (entry) => action.id === undefined || entry.id === action.id,
    );
    if (!removed.length) return state;
    return {
      entries:
        action.id === undefined ? [] : state.entries.filter((entry) => entry.id !== action.id),
      deleted: { entries: removed, order: state.entries.map((entry) => entry.id) },
    };
  }
  if (!state.deleted) return state;
  // Restore only the deleted records; keep subsequent additions and edits intact.
  const remaining = new Map(
    [...state.deleted.entries, ...state.entries].map((entry) => [entry.id, entry]),
  );
  const entries: MeasurementEntry[] = [];
  for (const id of state.deleted.order) {
    const entry = remaining.get(id);
    if (entry) {
      entries.push(entry);
      remaining.delete(id);
    }
  }
  return { entries: [...entries, ...remaining.values()], deleted: null };
}

export function useMeasurementRecords() {
  const [loaded] = useState(() => loadMeasurementNotebook());
  const [{ entries, deleted }, dispatch] = useReducer(recordsReducer, {
    entries: loaded.entries,
    deleted: null,
  });
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
  return {
    entries,
    storageWarning,
    setEntries: (value: SetStateAction<MeasurementEntry[]>) => dispatch({ type: 'update', value }),
    deleteEntries: (id?: string) => dispatch({ type: 'delete', id }),
    deletedCount: deleted?.entries.length ?? 0,
    restoreDeleted: () => dispatch({ type: 'restore' }),
  };
}
