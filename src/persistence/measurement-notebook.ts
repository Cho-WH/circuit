import { channelStorageKey } from '../release';
import Ajv2020 from 'ajv/dist/2020';
import circuitSchema from '../../schemas/circuit-document.schema.json';
import v6CircuitSchema from '../../schemas/circuit-document.v6.schema.json';
import notebookSchema from '../../schemas/measurement-notebook.schema.json';
import v5NotebookSchema from '../../schemas/measurement-notebook.v5.schema.json';
import { migrateDocument } from './migrate';
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
const key = 'edu-circuit:measurement-notebook:v6';
const previousKey = 'edu-circuit:measurement-notebook:v5';
const originalsKey = 'edu-circuit:measurement-notebook:originals:v1';
const copyWarning =
  '기록은 불러왔지만 이 기기에 새 형식으로 저장하지 못했어요. 원본은 유지되며 표 복사와 CSV 저장을 사용할 수 있어요.';
const ajv = new Ajv2020({ strict: false }).addSchema(circuitSchema).addSchema(v6CircuitSchema);
const validNotebook = ajv.compile<{ version: 6; entries: MeasurementEntry[] }>(notebookSchema);
const validPrevious = ajv.compile<{ version: 5; entries: MeasurementEntry[] }>(v5NotebookSchema);

export function parseMeasurementNotebook(text: string): MeasurementEntry[] {
  const data = JSON.parse(text);
  if (!validNotebook(data)) throw new Error('Invalid notebook');
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
    if (
      !record.ok ||
      entry.record.quality !== record.value.quality ||
      !['voltage', 'current', 'resistance'].includes(record.value.quantity)
    )
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

/** Pure v5 -> v6 conversion; validate the old envelope before touching snapshots. */
export function migrateMeasurementNotebook(text: string): MeasurementEntry[] {
  const data = JSON.parse(text);
  if (!validPrevious(data)) throw new Error('Invalid previous notebook');
  const entries = data.entries.map((entry: MeasurementEntry) => {
    const migrated = migrateDocument(JSON.stringify(entry.record.documentSnapshot));
    if (!migrated.ok) throw new Error('Invalid previous snapshot');
    return { ...entry, record: { ...entry.record, documentSnapshot: migrated.document } };
  });
  return parseMeasurementNotebook(JSON.stringify({ version: 6, entries }));
}

function source(storage: StorageAdapter, name: string) {
  const scoped = channelStorageKey(name),
    scopedRaw = storage.getItem(scoped);
  if (scopedRaw !== null) return { key: scoped, raw: scopedRaw };
  const raw = storage.getItem(name);
  return raw === null ? null : { key: name, raw };
}

function preserve(raw: string, storage: StorageAdapter) {
  const stored = storage.getItem(channelStorageKey(originalsKey));
  const originals: unknown = stored === null ? [] : JSON.parse(stored);
  if (!Array.isArray(originals) || !originals.every((v) => typeof v === 'string'))
    throw new Error('Invalid originals');
  if (!originals.includes(raw))
    storage.setItem(channelStorageKey(originalsKey), JSON.stringify([...originals, raw]));
}

/** Copy only into an absent v6 key; legacy sources (including their backup) remain intact. */
function adopt(
  storage: StorageAdapter,
  original: { key: string; raw: string },
  entries: MeasurementEntry[],
) {
  if (
    storage.getItem(channelStorageKey(key)) !== null ||
    storage.getItem(original.key) !== original.raw
  )
    throw new Error('Notebook source changed');
  try {
    storage.setItem(channelStorageKey(key), JSON.stringify({ version: 6, entries }));
    return true;
  } catch {
    // A quota failure must not discard successfully read entries or fall back to stale data.
    return false;
  }
}

export function loadMeasurementNotebook(storage?: StorageAdapter): {
  entries: MeasurementEntry[];
  warning?: string;
} {
  try {
    storage ??= localStorage;
    const current = source(storage, key);
    if (current) {
      try {
        const entries = parseMeasurementNotebook(current.raw);
        if (current.key === key && !adopt(storage, current, entries))
          return { entries, warning: copyWarning };
        return { entries };
      } catch {
        /* Only same-version backup may recover a damaged current notebook. */
      }
      const backup = source(storage, `${key}:backup`);
      if (backup)
        return {
          entries: parseMeasurementNotebook(backup.raw),
          warning: '이전 측정 기록을 복원했어요.',
        };
      return { entries: [], warning: '저장된 측정 기록을 읽지 못했어요.' };
    }
    const backup = source(storage, `${key}:backup`);
    if (backup) {
      const entries = parseMeasurementNotebook(backup.raw);
      return {
        entries,
        warning: adopt(storage, backup, entries) ? '이전 측정 기록을 복원했어요.' : copyWarning,
      };
    }
    const previous = source(storage, previousKey);
    if (previous) {
      try {
        const entries = migrateMeasurementNotebook(previous.raw);
        return adopt(storage, previous, entries) ? { entries } : { entries, warning: copyWarning };
      } catch {
        /* Check the legacy backup without modifying either source. */
      }
    }
    const previousBackup = source(storage, `${previousKey}:backup`);
    if (previousBackup) {
      const entries = migrateMeasurementNotebook(previousBackup.raw);
      return {
        entries,
        warning: adopt(storage, previousBackup, entries)
          ? '이전 측정 기록을 복원했어요.'
          : copyWarning,
      };
    }
    return previous
      ? { entries: [], warning: '저장된 측정 기록을 읽지 못했어요.' }
      : { entries: [] };
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
    const serialized = JSON.stringify({ version: 6, entries });
    parseMeasurementNotebook(serialized);
    const previous = source(storage, key);
    if (!previous) {
      // A failed/unknown legacy read must not silently turn into a new empty history.
      const old = source(storage, previousKey);
      if (old) migrateMeasurementNotebook(old.raw);
      const oldBackup = source(storage, `${previousKey}:backup`);
      if (oldBackup) migrateMeasurementNotebook(oldBackup.raw);
    }
    if (previous) {
      let previousValid = true;
      try {
        parseMeasurementNotebook(previous.raw);
      } catch {
        const backup = source(storage, `${key}:backup`);
        if (!backup) return false;
        parseMeasurementNotebook(backup.raw);
        preserve(previous.raw, storage);
        previousValid = false;
      }
      const backup = source(storage, `${key}:backup`);
      if (backup) {
        try {
          parseMeasurementNotebook(backup.raw);
        } catch {
          preserve(backup.raw, storage);
        }
      }
      if (storage.getItem(previous.key) !== previous.raw) return false;
      if (previousValid) storage.setItem(channelStorageKey(`${key}:backup`), previous.raw);
    }
    storage.setItem(channelStorageKey(key), serialized);
    return true;
  } catch {
    return false;
  }
}
