import { channelStorageKey, readChannelStorage } from '../release';
import { isStoredScalar, type EndpointRef } from '../domain';
import { createMeasurementRecord, type MeasurementRecord } from '../measurement';
import { wirePoints } from '../component-library';

export type MeasurementAnchor =
  | { kind: 'endpoint'; id: string; endpointKind: EndpointRef['kind'] }
  | { kind: 'wire'; id: string; segment: number; t: number }
  | { kind: 'component'; id: string };
export type MeasurementAnchors = Record<'red' | 'black' | 'current', MeasurementAnchor | null>;

/** User notes and measurement history are stored separately from CircuitDocument. */
export interface MeasurementEntry {
  id: string;
  record: MeasurementRecord;
  note: string;
  sourcesDisconnected: boolean;
  anchors: MeasurementAnchors;
  currentDirection?: { from: EndpointRef; to: EndpointRef };
}
type StorageAdapter = Pick<Storage, 'getItem' | 'setItem'>;
const key = 'edu-circuit:measurement-notebook:v4';

function parse(text: string): MeasurementEntry[] {
  const data = JSON.parse(text);
  if (data.version !== 4 || !Array.isArray(data.entries)) throw new Error('Invalid notebook');
  const ids = new Set<string>();
  return data.entries.map((entry: MeasurementEntry) => {
    if (
      !entry ||
      typeof entry.id !== 'string' ||
      !entry.id ||
      ids.has(entry.id) ||
      typeof entry.note !== 'string' ||
      typeof entry.sourcesDisconnected !== 'boolean' ||
      !entry.record
    )
      throw new Error('Invalid entry');
    if (entry.record.value !== null && !isStoredScalar(entry.record.value))
      throw new Error('Invalid measurement value');
    ids.add(entry.id);
    const record = createMeasurementRecord(entry.record.documentSnapshot, entry.record);
    if (!record.ok || entry.record.quality !== record.value.quality || !['voltage', 'current', 'resistance'].includes(record.value.quantity))
      throw new Error('Invalid measurement');
    const doc = record.value.documentSnapshot;
    const endpoints = new Map([
      ...doc.components.flatMap((c) => c.terminals.map((t) => [t.id, 'terminal'] as const)),
      ...doc.junctions.map((j) => [j.id, 'junction'] as const),
    ]);
    const current = record.value.quantity === 'current';
    if (
      entry.sourcesDisconnected !== (record.value.quantity === 'resistance') ||
      record.value.targetIds.length !== (current ? 1 : 2) ||
      !record.value.targetIds.every((id) =>
        current
          ? doc.components.some((c) => c.id === id) || doc.wires.some((w) => w.id === id)
          : endpoints.has(id),
      )
    )
      throw new Error('Invalid target');
    const validAnchor = (anchor: MeasurementAnchor | null, targetId: string): boolean => {
      if (!anchor || typeof anchor.id !== 'string') return false;
      if (anchor.kind === 'endpoint')
        return (
          !current && anchor.id === targetId && endpoints.get(anchor.id) === anchor.endpointKind
        );
      if (anchor.kind === 'component')
        return current && anchor.id === targetId && doc.components.some((c) => c.id === anchor.id);
      if (anchor.kind !== 'wire') return false;
      const wire = doc.wires.find((w) => w.id === anchor.id);
      return Boolean(
        wire &&
          (current ? wire.id : wire.start.id) === targetId &&
          Number.isInteger(anchor.segment) &&
          anchor.segment >= 0 &&
          anchor.segment < wirePoints(doc, wire).length - 1 &&
          Number.isFinite(anchor.t) &&
          anchor.t >= 0 &&
          anchor.t <= 1,
      );
    };
    const anchors = entry.anchors;
    if (
      !anchors ||
      (current
        ? anchors.red !== null ||
          anchors.black !== null ||
          !validAnchor(anchors.current, record.value.targetIds[0])
        : anchors.current !== null ||
          !validAnchor(anchors.red, record.value.targetIds[0]) ||
          !validAnchor(anchors.black, record.value.targetIds[1]))
    )
      throw new Error('Invalid measurement position');
    if (current) {
      const direction = entry.currentDirection;
      if (
        !direction ||
        ![direction.from, direction.to].every((e) => e && endpoints.get(e.id) === e.kind)
      )
        throw new Error('Invalid direction');
    } else if (entry.currentDirection !== undefined) throw new Error('Unexpected direction');
    return { ...entry, record: record.value };
  });
}

export function loadMeasurementNotebook(storage?: StorageAdapter): {
  entries: MeasurementEntry[];
  warning?: string;
} {
  try {
    storage ??= localStorage;
    const raw = readChannelStorage(storage, key, text => { parse(text); return true; });
    if (raw === null) return { entries: [] };
    try {
      return { entries: parse(raw) };
    } catch {
      const backup = readChannelStorage(storage, `${key}:backup`, text => { parse(text); return true; });
      if (backup) return { entries: parse(backup), warning: '이전 측정 기록을 복원했어요.' };
      return { entries: [], warning: '저장된 측정 기록을 읽지 못했어요.' };
    }
  } catch {
    return { entries: [], warning: '이 브라우저에서는 측정 기록을 불러올 수 없어요.' };
  }
}

export function saveMeasurementNotebook(
  entries: MeasurementEntry[],
  storage?: StorageAdapter,
): boolean {
  try {
    storage ??= localStorage;
    const serialized = JSON.stringify({ version: 4, entries });
    parse(serialized);
    const previous = readChannelStorage(storage, key, text => { parse(text); return true; });
    if (previous) {
      try {
        parse(previous);
        storage.setItem(channelStorageKey(`${key}:backup`), previous);
      } catch {
        /* Keep an existing valid backup. */
      }
    }
    storage.setItem(channelStorageKey(key), serialized);
    return true;
  } catch {
    return false;
  }
}
