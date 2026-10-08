import { channelStorageKey } from '../release';
import { migrateDocument } from './migrate';
import {
  DocumentError,
  diagnostic,
  validateDocument,
  type CircuitDocument,
  type DocumentValidation,
} from '../domain';
export { loadMeasurementNotebook, saveMeasurementNotebook, type MeasurementEntry, type MeasurementAnchor, type MeasurementAnchors } from './measurement-notebook';

type StorageAdapter = Pick<Storage, 'getItem' | 'setItem'>;
type StorageKind = 'auto' | 'manual';
type SaveResult = { ok: true } | { ok: false; error: string };

const STORAGE_KEYS: Record<StorageKind, string> = {
  auto: 'edu-circuit:auto:v1',
  manual: 'edu-circuit:manual:v1',
};
const AUTO_BACKUP_KEY = 'edu-circuit:auto:v1:backup';
const ORIGINAL_KEY = 'edu-circuit:originals:v1';

export interface RecoverySource { raw: string; storageKey?: string; filename?: string }

export function recoveryReason(raw: string): 'older-version' | 'newer-version' | 'invalid-data' {
  const currentVersion: CircuitDocument['version'] = 6;
  try {
    const data = JSON.parse(raw);
    if (data?.format === 'edu-circuit' && Number.isInteger(data.version) && data.version > 0) {
      if (data.version < currentVersion) return 'older-version';
      if (data.version > currentVersion) return 'newer-version';
    }
  } catch { /* Invalid JSON is reported with the other unreadable file contents. */ }
  return 'invalid-data';
}

/** Read even incompatible legacy data, without adopting or changing it. */
export function readLocalSource(kind: StorageKind = 'auto', storage?: StorageAdapter): RecoverySource | null {
  const target = storage ?? defaultStorage();
  const scoped = channelStorageKey(STORAGE_KEYS[kind]);
  const raw = target.getItem(scoped);
  if (raw !== null) return { raw, storageKey: scoped };
  const legacy = target.getItem(STORAGE_KEYS[kind]);
  return legacy === null ? null : { raw: legacy, storageKey: STORAGE_KEYS[kind] };
}

export function loadCircuitSession(): { document?: CircuitDocument; recovery?: RecoverySource; readFailed?: boolean } {
  try {
    let source = readLocalSource();
    if (!source) {
      const target = defaultStorage();
      const scoped = channelStorageKey(AUTO_BACKUP_KEY);
      const raw = target.getItem(scoped);
      const legacy = raw === null ? target.getItem(AUTO_BACKUP_KEY) : null;
      if (raw !== null) source = { raw, storageKey: scoped };
      else if (legacy !== null) source = { raw: legacy, storageKey: AUTO_BACKUP_KEY };
    }
    if (!source) return {};
    const parsed = parseDocument(source.raw);
    return parsed.ok ? { document: parsed.document } : { recovery: source };
  } catch {
    // Storage access failures are reported by the existing failed-save UI.
    return { readFailed: true };
  }
}

/** Recovery never writes, drops components, or guesses missing connections. */
export function recoverDocument(source: RecoverySource, storage?: StorageAdapter): DocumentValidation {
  const current = parseDocument(source.raw);
  if (current.ok) return current;
  const migrated = migrateDocument(source.raw);
  if (migrated.ok) return migrated;
  if (source.storageKey && [STORAGE_KEYS.auto, channelStorageKey(STORAGE_KEYS.auto)].includes(source.storageKey)) {
    try {
      const target = storage ?? defaultStorage();
      const backup = target.getItem(channelStorageKey(AUTO_BACKUP_KEY)) ?? target.getItem(AUTO_BACKUP_KEY);
      if (backup !== null) {
        const parsed = parseDocument(backup);
        if (parsed.ok) return parsed;
        return migrateDocument(backup);
      }
    } catch { /* A failed recovery leaves the source untouched. */ }
  }
  return migrated;
}

/** Originals are separate from the rolling autosave backup and are never rotated out. */
export function originalBackups(storage?: StorageAdapter): string[] {
  const raw = (storage ?? defaultStorage()).getItem(channelStorageKey(ORIGINAL_KEY));
  if (raw === null) return [];
  const values: unknown = JSON.parse(raw);
  if (!Array.isArray(values) || !values.every(value => typeof value === 'string')) throw new Error('Invalid original backup');
  return values;
}

function preserveOriginal(raw: string, target: StorageAdapter) {
  const originals = originalBackups(target);
  if (originals.includes(raw)) return;
  target.setItem(channelStorageKey(ORIGINAL_KEY), JSON.stringify([...originals, raw]));
}

/** Commit only after validation and durable preservation; stale dialogs cannot replace newer data. */
export function saveRecoveredLocal(document: CircuitDocument, source: RecoverySource, storage?: StorageAdapter): SaveResult {
  try {
    const target = storage ?? defaultStorage();
    const serialized = serializeDocument(document);
    if (source.storageKey && target.getItem(source.storageKey) !== source.raw) throw new Error('Recovery source changed');
    preserveOriginal(source.raw, target);
    const previous = readLocalSource('auto', target);
    if (previous && !parseDocument(previous.raw).ok) preserveOriginal(previous.raw, target);
    const previousRaw = target.getItem(channelStorageKey(STORAGE_KEYS.auto));
    if (previousRaw !== null && parseDocument(previousRaw).ok) storeAutomaticBackup(previousRaw, target);
    target.setItem(channelStorageKey(STORAGE_KEYS.auto), serialized);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

function storeAutomaticBackup(raw: string, target: StorageAdapter) {
  const key = channelStorageKey(AUTO_BACKUP_KEY);
  const previous = target.getItem(key);
  if (previous !== null && !parseDocument(previous).ok) preserveOriginal(previous, target);
  target.setItem(key, raw);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function storageFailure(code: string, error: unknown): DocumentValidation {
  return {
    ok: false,
    diagnostics: [
      diagnostic(code, [], 'error', {
        detail: errorMessage(error),
      }),
    ],
  };
}

function defaultStorage(): StorageAdapter {
  const storage = globalThis.localStorage;
  if (!storage) throw new Error('Browser local storage is unavailable.');
  return storage;
}

export function serializeDocument(document: CircuitDocument): string {
  const validation = validateDocument(document);
  if (!validation.ok) throw new DocumentError(validation.diagnostics);
  return JSON.stringify(validation.document, null, 2);
}

export function parseDocument(text: string): DocumentValidation {
  try {
    return validateDocument(JSON.parse(text) as unknown);
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        diagnostic('INVALID_JSON', [], 'error', {
          detail: errorMessage(error),
        }),
      ],
    };
  }
}

export function saveLocal(
  document: CircuitDocument,
  kind: StorageKind = 'auto',
  storage?: StorageAdapter,
): SaveResult {
  try {
    const serialized = serializeDocument(document);
    const target = storage ?? defaultStorage();
    const key = channelStorageKey(STORAGE_KEYS[kind]);
    const original = readLocalSource(kind, target);
    if (original && !parseDocument(original.raw).ok) throw new Error('Stored circuit requires recovery');

    if (kind === 'auto') {
      const previous = target.getItem(key);
      if (previous !== null && parseDocument(previous).ok) {
        storeAutomaticBackup(previous, target);
      }
    }

    target.setItem(key, serialized);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export function loadLocal(
  kind: StorageKind = 'auto',
  storage?: StorageAdapter,
): DocumentValidation | null {
  try {
    const target = storage ?? defaultStorage();
    const source = readLocalSource(kind, target);
    const primary = source === null ? null : parseDocument(source.raw);
    if (source && primary?.ok && source.storageKey === STORAGE_KEYS[kind])
      target.setItem(channelStorageKey(STORAGE_KEYS[kind]), source.raw);
    return primary;
  } catch (error) {
    return storageFailure('STORAGE_READ_FAILED', error);
  }
}
