import {
  DocumentError,
  diagnostic,
  validateDocument,
  type CircuitDocument,
  type DocumentValidation,
} from '../domain';

type StorageAdapter = Pick<Storage, 'getItem' | 'setItem'>;
type StorageKind = 'auto' | 'manual';
type SaveResult = { ok: true } | { ok: false; error: string };

const STORAGE_KEYS: Record<StorageKind, string> = {
  auto: 'edu-circuit:auto:v1',
  manual: 'edu-circuit:manual:v1',
};
const AUTO_BACKUP_KEY = 'edu-circuit:auto:v1:backup';

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
    const key = STORAGE_KEYS[kind];

    if (kind === 'auto') {
      const previous = target.getItem(key);
      if (previous !== null && parseDocument(previous).ok) {
        target.setItem(AUTO_BACKUP_KEY, previous);
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
    const stored = target.getItem(STORAGE_KEYS[kind]);
    if (stored === null) return null;

    const primary = parseDocument(stored);
    if (primary.ok || kind === 'manual') return primary;

    const backup = target.getItem(AUTO_BACKUP_KEY);
    if (backup === null) return primary;
    const recovery = parseDocument(backup);
    return recovery.ok ? recovery : primary;
  } catch (error) {
    return storageFailure('STORAGE_READ_FAILED', error);
  }
}
