import { afterEach, describe, expect, it, vi } from 'vitest';
import { examples } from '../src/fixtures';
import { createMeasurementRecord } from '../src/measurement';
import {
  loadLocal,
  saveLocal,
  serializeDocument,
  loadMeasurementNotebook,
  saveMeasurementNotebook,
  type MeasurementEntry,
} from '../src/persistence';
import { releaseChannel, channelStorageKey, readChannelStorage } from '../src/release';
import * as q from '../src/rational';

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

function document(title: string) {
  const doc = structuredClone(examples.find((e) => e.id === 'FIX-02')!.document);
  doc.title = title;
  return doc;
}

function entry(note: string): MeasurementEntry {
  const result = createMeasurementRecord(document(note), {
    condition: '정상 연결',
    source: 'simulation',
    quantity: 'voltage',
    value: q.store(3),
    unit: 'V',
    targetIds: ['R1.a', 'R1.b'],
  });
  if (!result.ok) throw new Error('Invalid fixture');
  return {
    id: 'one',
    record: result.value,
    note,
    sourcesDisconnected: false,
    anchors: {
      red: { kind: 'endpoint', id: 'R1.a', endpointKind: 'terminal' },
      black: { kind: 'endpoint', id: 'R1.b', endpointKind: 'terminal' },
      current: null,
    },
  };
}

afterEach(() => vi.unstubAllEnvs());

describe('release channel storage', () => {
  it('recovers compatible legacy backups even when their primary copy is damaged', () => {
    const store = storage();
    vi.stubEnv('VITE_RELEASE_CHANNEL', 'main');
    store.setItem('edu-circuit:auto:v1', '{broken');
    store.setItem('edu-circuit:auto:v1:backup', serializeDocument(document('recovered')));
    expect(loadLocal('auto', store)).toMatchObject({ ok: true, document: { title: 'recovered' } });
    saveMeasurementNotebook([entry('recovered notes')], store);
    const scoped = [...store.values.keys()].find((k) => k.includes('measurement-notebook:'))!;
    const raw = store.getItem(scoped)!;
    const legacy = scoped.slice('main:'.length);
    store.values.delete(scoped);
    store.setItem(legacy, '{broken');
    store.setItem(legacy + ':backup', raw);
    expect(loadMeasurementNotebook(store)).toMatchObject({
      entries: [{ note: 'recovered notes' }],
      warning: expect.any(String),
    });
    expect(store.getItem(legacy)).toBe('{broken');
    expect(store.getItem(legacy + ':backup')).toBe(raw);
  });

  it('keeps auto, manual and recovery copies separate on the same origin', () => {
    const store = storage();
    for (const channel of ['main', 'dev'] as const) {
      vi.stubEnv('VITE_RELEASE_CHANNEL', channel);
      expect(releaseChannel()).toBe(channel);
      expect(saveLocal(document(`${channel} backup`), 'auto', store).ok).toBe(true);
      expect(saveLocal(document(`${channel} current`), 'auto', store).ok).toBe(true);
      expect(saveLocal(document(`${channel} manual`), 'manual', store).ok).toBe(true);
    }
    for (const channel of ['main', 'dev'] as const) {
      vi.stubEnv('VITE_RELEASE_CHANNEL', channel);
      expect(loadLocal('auto', store)).toMatchObject({
        ok: true,
        document: { title: `${channel} current` },
      });
      expect(loadLocal('manual', store)).toMatchObject({
        ok: true,
        document: { title: `${channel} manual` },
      });
      store.setItem(channelStorageKey('edu-circuit:auto:v1'), '{broken');
      expect(loadLocal('auto', store)).toMatchObject({
        ok: true,
        document: { title: `${channel} backup` },
      });
    }
  });

  it('does not use the other channel as a fallback when its own data is absent', () => {
    const store = storage();
    vi.stubEnv('VITE_RELEASE_CHANNEL', 'main');
    saveLocal(document('stable'), 'auto', store);
    saveLocal(document('stable'), 'manual', store);
    saveMeasurementNotebook([entry('stable')], store);
    vi.stubEnv('VITE_RELEASE_CHANNEL', 'dev');
    expect(loadLocal('auto', store)).toBeNull();
    expect(loadLocal('manual', store)).toBeNull();
    expect(loadMeasurementNotebook(store)).toEqual({ entries: [] });
  });

  it('copies compatible legacy circuits once without deleting or changing the original', () => {
    const store = storage();
    const legacy = serializeDocument(document('before channels'));
    for (const kind of ['auto', 'manual'] as const) {
      const key = `edu-circuit:${kind}:v1`;
      store.setItem(key, legacy);
      vi.stubEnv('VITE_RELEASE_CHANNEL', 'main');
      expect(loadLocal(kind, store)).toMatchObject({
        ok: true,
        document: { title: 'before channels' },
      });
      saveLocal(document('stable changed'), kind, store);
      vi.stubEnv('VITE_RELEASE_CHANNEL', 'dev');
      expect(loadLocal(kind, store)).toMatchObject({
        ok: true,
        document: { title: 'before channels' },
      });
      vi.stubEnv('VITE_RELEASE_CHANNEL', 'main');
      expect(loadLocal(kind, store)).toMatchObject({
        ok: true,
        document: { title: 'stable changed' },
      });
      expect(store.getItem(key)).toBe(legacy);
    }
  });

  it('preserves unsupported legacy documents without adopting or converting them', () => {
    const store = storage();
    const legacy = JSON.stringify({ ...document('unsupported'), version: 999 });
    store.setItem('edu-circuit:auto:v1', legacy);
    for (const channel of ['main', 'dev'] as const) {
      vi.stubEnv('VITE_RELEASE_CHANNEL', channel);
      expect(loadLocal('auto', store)).toBeNull();
      expect(store.getItem(channelStorageKey('edu-circuit:auto:v1'))).toBeNull();
    }
    expect(store.getItem('edu-circuit:auto:v1')).toBe(legacy);
  });

  it('separates notebook notes, deletions and backup recovery', () => {
    const store = storage();
    for (const channel of ['main', 'dev'] as const) {
      vi.stubEnv('VITE_RELEASE_CHANNEL', channel);
      expect(saveMeasurementNotebook([entry(`${channel} backup`)], store)).toBe(true);
      expect(saveMeasurementNotebook([entry(`${channel} current`)], store)).toBe(true);
    }
    for (const channel of ['main', 'dev'] as const) {
      vi.stubEnv('VITE_RELEASE_CHANNEL', channel);
      expect(loadMeasurementNotebook(store).entries[0].note).toBe(`${channel} current`);
      const key = [...store.values.keys()].find(
        (k) =>
          k.startsWith(`${channel}:edu-circuit:measurement-notebook:`) && !k.endsWith(':backup'),
      )!;
      store.setItem(key, '{broken');
      expect(loadMeasurementNotebook(store)).toMatchObject({
        entries: [{ note: `${channel} backup` }],
        warning: expect.any(String),
      });
      expect(saveMeasurementNotebook([], store)).toBe(true);
      expect(loadMeasurementNotebook(store)).toEqual({ entries: [] });
    }
  });

  it('adopts valid legacy notes once and does not resurrect a cleared notebook', () => {
    const store = storage();
    vi.stubEnv('VITE_RELEASE_CHANNEL', 'dev');
    saveMeasurementNotebook([entry('legacy note')], store);
    const [scoped, raw] = [...store.values.entries()][0];
    const legacyKey = scoped.slice('dev:'.length);
    store.values.delete(scoped);
    store.setItem(legacyKey, raw);
    expect(loadMeasurementNotebook(store).entries[0].note).toBe('legacy note');
    saveMeasurementNotebook([], store);
    expect(loadMeasurementNotebook(store)).toEqual({ entries: [] });
    expect(store.getItem(legacyKey)).toBe(raw);
    vi.stubEnv('VITE_RELEASE_CHANNEL', 'main');
    store.setItem(legacyKey, JSON.stringify({ version: 999, entries: [] }));
    expect(loadMeasurementNotebook(store)).toEqual({ entries: [] });
    expect(store.getItem(channelStorageKey(legacyKey))).toBeNull();
  });

  it('isolates small preferences and propagates storage failures to the caller', () => {
    const store = storage();
    const key = 'circuit.quick-start-seen';
    vi.stubEnv('VITE_RELEASE_CHANNEL', 'main');
    store.setItem(channelStorageKey(key), 'true');
    vi.stubEnv('VITE_RELEASE_CHANNEL', 'dev');
    expect(readChannelStorage(store, key, (value) => value === 'true')).toBeNull();
    store.setItem(key, 'true');
    const blocked = {
      getItem: store.getItem,
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() => readChannelStorage(blocked, key, () => true)).toThrow('quota');
    expect(store.getItem(key)).toBe('true');
  });
});
