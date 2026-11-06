import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  emptyDocument,
  validateDocument,
  validRcFrameContext,
  rcPolicy,
  type CircuitDocument,
  type RcFrameContext,
  type RcPrepareRequest,
  type RcEngine,
} from '../src/domain';
import { createComponent, componentDefinitions, symbolMarkup } from '../src/component-library';
import { compileCircuit } from '../src/connectivity';
import { solveCircuit, analyzeOperatingCircuit } from '../src/simulation';
import { parseQuantity, formatQuantity } from '../src/quantity';
import * as q from '../src/rational';
import { createMeasurementRecord, measurementsToCsv } from '../src/measurement';
import {
  parseDocument,
  serializeDocument,
  recoverDocument,
  saveRecoveredLocal,
  saveLocal,
  originalBackups,
  loadMeasurementNotebook,
  saveMeasurementNotebook,
  migrateMeasurementNotebook,
  parseMeasurementNotebook,
  type MeasurementEntry,
} from '../src/persistence';
import { channelStorageKey } from '../src/release';
import { examples } from '../src/fixtures';

function circuit(): CircuitDocument {
  const doc = emptyDocument('rc-contract');
  const capacitor = createComponent('capacitor', 'C1', { x: 100, y: 80 }, 'C_1');
  capacitor.properties.initialVoltageV = q.store(q.rational(-1n, 3n));
  doc.components.push(capacitor);
  return doc;
}
const context = (equilibrium = false): RcFrameContext => ({
  model: 'linear-rc',
  modelRevision: 1,
  arithmeticPolicy: 'rc-modal-1',
  settlingPolicy: 'rc-envelope-1',
  circuitRevision: 'electrical:1',
  operationIndex: 2,
  frameId: 'op:2:frame:3',
  time: equilibrium ? { kind: 'equilibrium' } : { kind: 'finite', seconds: 0.25 },
});
function entry(equilibrium = false): MeasurementEntry {
  const value = equilibrium
    ? q.store(q.rational(-1n, 3n))
    : {
        ...q.store(q.rational(-1n, 4n)),
        approximation: {
          reason: 'rc-modal' as const,
          policy: 'rc-modal-1' as const,
          absoluteError: 1e-12,
        },
      };
  const result = createMeasurementRecord(circuit(), {
    condition: '스위치 조작 2',
    source: 'simulation',
    quantity: 'voltage',
    unit: 'V',
    targetIds: ['C1.a', 'C1.b'],
    value,
    transient: context(equilibrium),
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return {
    id: equilibrium ? 'equilibrium' : 'finite',
    note: '관찰',
    sourcesDisconnected: false,
    record: result.value,
    anchors: {
      red: { kind: 'endpoint', id: 'C1.a', endpointKind: 'terminal' },
      black: { kind: 'endpoint', id: 'C1.b', endpointKind: 'terminal' },
      current: null,
    },
  };
}
function storage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}
function legacyNotebook() {
  const doc = structuredClone(examples.find((e) => e.id === 'FIX-02')!.document);
  const record = createMeasurementRecord(doc, {
    source: 'simulation',
    condition: '이전 DC',
    quantity: 'voltage',
    unit: 'V',
    targetIds: ['R1.a', 'R1.b'],
    value: q.rational(1n, 3n),
    provenance: {
      physicalModel: 'textbook',
      profileRevision: 'test@1',
      arithmeticQuality: 'exact',
    },
  });
  if (!record.ok) throw new Error('legacy fixture');
  return JSON.stringify({
    version: 5,
    entries: [
      {
        id: 'old',
        record: { ...record.value, documentSnapshot: { ...doc, version: 6 } },
        note: '원본 메모',
        sourcesDisconnected: false,
        anchors: {
          red: { kind: 'endpoint', id: 'R1.a', endpointKind: 'terminal' },
          black: { kind: 'endpoint', id: 'R1.b', endpointKind: 'terminal' },
          current: null,
        },
      },
    ],
  });
}
afterEach(() => vi.unstubAllEnvs());

describe('C1 public capacitor and RC contracts', () => {
  it('round trips exact C, signed initial voltage and presentation without runtime state', () => {
    const doc = circuit();
    doc.components[0].properties.labelOffsetX = 13;
    doc.components[0].rotation = 180;
    const raw = serializeDocument(doc);
    expect(doc.version).toBe(7);
    expect(parseDocument(raw)).toEqual({ ok: true, document: doc });
    expect(doc.components[0].properties.capacitanceF).toEqual(q.store(q.rational(1n, 10000n)));
    expect(createComponent('capacitor', 'C2', { x: 0, y: 0 }).properties.initialVoltageV).toEqual(
      q.store(0),
    );
    for (const key of ['currentCharge', 'time', 'plan']) {
      expect(validateDocument({ ...doc, [key]: 1 }).ok).toBe(false);
      const changed = structuredClone(doc);
      changed.components[0].properties[key] = 1;
      expect(validateDocument(changed).ok).toBe(false);
    }
  });
  it('rejects invalid, approximate or missing capacitor inputs and ambiguous terminal roles', () => {
    for (const value of [
      0,
      q.store(0),
      q.store(-1),
      { numerator: '2', denominator: '4' },
      {
        ...q.store(1),
        approximation: {
          reason: 'rc-modal' as const,
          policy: 'rc-modal-1' as const,
          absoluteError: 0,
        },
      },
    ]) {
      const doc = circuit();
      doc.components[0].properties.capacitanceF = value;
      expect(validateDocument(doc).ok).toBe(false);
    }
    for (const key of ['capacitanceF', 'initialVoltageV']) {
      const doc = circuit();
      delete doc.components[0].properties[key];
      expect(validateDocument(doc).ok).toBe(false);
    }
    const doc = circuit();
    doc.components[0].terminals[1].role = 'a';
    expect(validateDocument(doc).ok).toBe(false);
    const other = emptyDocument();
    const r = createComponent('resistor', 'R', { x: 0, y: 0 });
    r.properties.initialVoltageV = q.store(2);
    other.components.push(r);
    expect(validateDocument(other).ok).toBe(false);
  });
  it('compiles C and initial voltage by role/ID and refuses DC substitution', () => {
    const doc = circuit();
    doc.components[0].terminals.reverse();
    const compiled = compileCircuit(doc);
    expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const cap = compiled.circuit.elements[0];
    expect(cap).toMatchObject({
      type: 'capacitor',
      a: 'net:C1.a',
      b: 'net:C1.b',
      aTerminalId: 'C1.a',
      bTerminalId: 'C1.b',
      value: q.rational(1n, 10000n),
      initialVoltageV: q.rational(-1n, 3n),
    });
    for (const physicalModel of ['textbook', 'component'] as const) {
      const result = solveCircuit(compiled.circuit, { physicalModel });
      expect(result.status).toBe('error');
      expect(result.diagnostics[0].code).toBe('RC_ENGINE_REQUIRED');
      expect(result.branchCurrents).toEqual({});
    }
    expect(analyzeOperatingCircuit(compiled.circuit).result.status).toBe('error');
    // A consumer can construct a request through public imports; no C0 internals are exposed.
    const request: RcPrepareRequest = {
      circuit: compiled.circuit,
      initialState: [
        {
          componentId: 'C1',
          aTerminalId: 'C1.a',
          bTerminalId: 'C1.b',
          voltageV: q.rational(-1n, 3n),
        },
      ],
      circuitRevision: 'electrical:1',
      operationIndex: 0,
      transition: 'initial',
      policy: rcPolicy,
    };
    const prepare: RcEngine['prepare'] = () => ({
      ok: false,
      diagnostics: [
        {
          code: 'RC_ENGINE_REQUIRED',
          severity: 'error',
          affectedIds: ['C1'],
          parameters: {},
          suggestedActions: [],
        },
      ],
    });
    expect(prepare(request).ok).toBe(false);
    expect(componentDefinitions.capacitor.available).not.toBe(false);
    expect(symbolMarkup(doc.components[0])).toContain('data-symbol="capacitor"');
  });
  it('supports exact capacitance/charge unit parsing while retaining RC approximation metadata', () => {
    expect(parseQuantity('100 μF', 'F')?.value).toEqual(q.store(q.rational(1n, 10000n)));
    expect(parseQuantity('-3 nC', 'C')?.value).toEqual(q.store(q.rational(-3n, 1_000_000_000n)));
    expect(formatQuantity(q.rational(1n, 10000n), 'F')).toContain('F');
    const scalar = entry().record.value!;
    expect(q.store(q.from(scalar))).toEqual(scalar);
    expect(q.neg(scalar).approximation).toEqual(scalar.approximation);
  });
});

describe('C1 circuit migration and original protection', () => {
  it.each([5, 6])(
    'requires explicit recovery of v%s and preserves all original data',
    (version) => {
      const source =
        version === 5
          ? JSON.parse(readFileSync('tests/data/circuit-v5.json', 'utf8'))
          : { ...structuredClone(examples[0].document), version: 6 };
      const raw = JSON.stringify(source),
        store = storage(),
        key = channelStorageKey('edu-circuit:auto:v1');
      store.setItem(key, raw);
      expect(parseDocument(raw).ok).toBe(false);
      expect(saveLocal(emptyDocument(), 'auto', store).ok).toBe(false);
      const recovered = recoverDocument({ raw, storageKey: key }, store);
      expect(recovered).toEqual({ ok: true, document: { ...source, version: 7 } });
      expect(store.getItem(key)).toBe(raw);
      if (!recovered.ok) throw new Error('recovery');
      expect(saveRecoveredLocal(recovered.document, { raw, storageKey: key }, store).ok).toBe(true);
      expect(originalBackups(store)).toContain(raw);
      expect(JSON.parse(store.getItem(key)!).version).toBe(7);
    },
  );
  it('rejects fake legacy capacitors, broken references and unsupported versions without changes', () => {
    for (const source of [
      { ...circuit(), version: 6 },
      { ...circuit(), version: 8 },
      { ...examples[0].document, version: 6, referenceNode: { kind: 'terminal', id: 'missing' } },
    ]) {
      const raw = JSON.stringify(source),
        store = storage();
      expect(recoverDocument({ raw }, store).ok).toBe(false);
      expect(store.data.size).toBe(0);
      expect(JSON.stringify(source)).toBe(raw);
    }
  });
});

describe('C1 measurement v6 and time provenance', () => {
  it('round trips finite/equilibrium records with independent scalar quality and exports their origin', () => {
    const records = [entry(), entry(true)],
      store = storage();
    expect(saveMeasurementNotebook(records, store)).toBe(true);
    expect(loadMeasurementNotebook(store)).toEqual({ entries: records });
    const raw = store.getItem(channelStorageKey('edu-circuit:measurement-notebook:v6'))!;
    expect(JSON.parse(raw).version).toBe(6);
    expect(parseMeasurementNotebook(raw)).toEqual(records);
    const csv = measurementsToCsv(records.map((e) => e.record));
    expect(csv.ok).toBe(true);
    if (csv.ok) {
      expect(csv.value).toContain('timeKind,physicalSeconds');
      expect(csv.value).toContain('finite,0.25');
      expect(csv.value).toContain('equilibrium,');
      expect(csv.value).toContain('rc-modal-1');
    }
    expect(records[0].record.quality).toBe('approximate');
    expect(records[1].record.quality).toBe('exact');
  });
  it('rejects malformed time, unknown policies and inconsistent arithmetic metadata', () => {
    const malformed = [
      null,
      { ...context(), time: { kind: 'finite', seconds: -1 } },
      { ...context(), time: { kind: 'finite', seconds: Infinity } },
      { ...context(true), time: { kind: 'equilibrium', seconds: 7 } },
      { ...context(), operationIndex: 0.2 },
      { ...context(), settlingPolicy: 'unknown' },
      { ...context(), arithmeticPolicy: 'dc-budget-1' },
    ];
    for (const transient of malformed) {
      expect(validRcFrameContext(transient)).toBe(false);
      const saved = entry();
      saved.record.transient = transient as RcFrameContext;
      expect(saveMeasurementNotebook([saved], storage())).toBe(false);
      expect(measurementsToCsv([saved.record]).ok).toBe(false);
    }
    for (const mutate of [
      (saved: MeasurementEntry) => {
        delete saved.record.transient;
      },
      (saved: MeasurementEntry) => {
        saved.record.quality = 'exact';
      },
      (saved: MeasurementEntry) => {
        saved.record.provenance = {
          physicalModel: 'textbook',
          profileRevision: '1',
          arithmeticQuality: 'approximate',
        };
      },
      (saved: MeasurementEntry) => {
        saved.record.source = 'external';
      },
      (saved: MeasurementEntry) => {
        saved.record.value!.approximation = {
          reason: 'operation-limit',
          policy: 'dc-budget-1',
          absoluteError: 1e-12,
        };
      },
      (saved: MeasurementEntry) => {
        saved.record.documentSnapshot = structuredClone(examples[0].document);
      },
    ]) {
      const saved = entry();
      mutate(saved);
      expect(saveMeasurementNotebook([saved], storage())).toBe(false);
    }
  });
  it('copies v5 records once without manufacturing time information or modifying source keys', () => {
    const store = storage(),
      raw = legacyNotebook(),
      oldKey = channelStorageKey('edu-circuit:measurement-notebook:v5');
    store.setItem(oldKey, raw);
    store.setItem(`${oldKey}:backup`, raw);
    const entries = migrateMeasurementNotebook(raw);
    expect(entries[0].record.transient).toBeUndefined();
    expect(entries[0].record.documentSnapshot.version).toBe(7);
    expect(entries[0].record.value).toEqual(q.store(q.rational(1n, 3n)));
    expect(loadMeasurementNotebook(store)).toEqual({ entries });
    expect(store.getItem(oldKey)).toBe(raw);
    expect(store.getItem(`${oldKey}:backup`)).toBe(raw);
    expect(saveMeasurementNotebook([], store)).toBe(true);
    expect(loadMeasurementNotebook(store)).toEqual({ entries: [] });
    expect(store.getItem(oldKey)).toBe(raw);
  });
  it('preserves legacy DC approximate provenance and rejects smuggled RC/invalid snapshot data', () => {
    const old = JSON.parse(legacyNotebook());
    old.entries[0].record.quality = 'approximate';
    old.entries[0].record.provenance.arithmeticQuality = 'approximate';
    old.entries[0].record.value.approximation = {
      reason: 'operation-limit',
      policy: 'dc-budget-1',
      absoluteError: 1e-9,
    };
    expect(migrateMeasurementNotebook(JSON.stringify(old))[0].record.value?.approximation).toEqual(
      old.entries[0].record.value.approximation,
    );
    for (const mutate of [
      (data: typeof old) => {
        data.entries[0].record.transient = context();
      },
      (data: typeof old) => {
        data.entries[0].record.documentSnapshot.referenceNode.id = 'missing';
      },
      (data: typeof old) => {
        data.entries[0].record.documentSnapshot.version = 7;
      },
      (data: typeof old) => {
        data.entries[0].record.value.approximation.reason = 'rc-modal';
      },
      (data: typeof old) => {
        data.version = 99;
      },
    ]) {
      const data = structuredClone(old);
      mutate(data);
      expect(() => migrateMeasurementNotebook(JSON.stringify(data))).toThrow();
    }
  });
  it('rejects damaged/future primary data and never resurrects v5 over an existing v6 key', () => {
    for (const raw of ['{broken', JSON.stringify({ version: 99, entries: [] })]) {
      const store = storage(),
        current = channelStorageKey('edu-circuit:measurement-notebook:v6');
      store.setItem(current, raw);
      store.setItem(channelStorageKey('edu-circuit:measurement-notebook:v5'), legacyNotebook());
      expect(loadMeasurementNotebook(store)).toMatchObject({
        entries: [],
        warning: expect.any(String),
      });
      expect(saveMeasurementNotebook([], store)).toBe(false);
      expect(store.getItem(current)).toBe(raw);
    }
    const store = storage(),
      key = channelStorageKey('edu-circuit:measurement-notebook:v5');
    store.setItem(key, '{broken');
    expect(loadMeasurementNotebook(store).warning).toBeTruthy();
    expect(saveMeasurementNotebook([], store)).toBe(false);
    expect(store.getItem(key)).toBe('{broken');
    expect(store.getItem(channelStorageKey('edu-circuit:measurement-notebook:v6'))).toBeNull();
  });
  it('recovers a legacy backup and keeps invalid original bytes', () => {
    const store = storage(),
      oldKey = channelStorageKey('edu-circuit:measurement-notebook:v5'),
      raw = legacyNotebook();
    store.setItem(oldKey, '{broken');
    store.setItem(`${oldKey}:backup`, raw);
    expect(loadMeasurementNotebook(store)).toMatchObject({
      entries: [{ note: '원본 메모' }],
      warning: expect.any(String),
    });
    expect(store.getItem(oldKey)).toBe('{broken');
    expect(store.getItem(`${oldKey}:backup`)).toBe(raw);
  });
  it('does not change legacy sources or replace a concurrently created v6 target on adoption failure', () => {
    const store = storage(),
      oldKey = channelStorageKey('edu-circuit:measurement-notebook:v5'),
      raw = legacyNotebook();
    store.setItem(oldKey, raw);
    const denied = {
      ...store,
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(loadMeasurementNotebook(denied)).toMatchObject({
      entries: [{ note: '원본 메모' }],
      warning: expect.any(String),
    });
    expect(store.getItem(oldKey)).toBe(raw);
    const current = channelStorageKey('edu-circuit:measurement-notebook:v6');
    let reads = 0;
    const racing = {
      ...store,
      getItem: (key: string) => {
        if (key === current && ++reads === 2)
          store.setItem(current, JSON.stringify({ version: 6, entries: [] }));
        return store.getItem(key);
      },
    };
    loadMeasurementNotebook(racing);
    expect(store.getItem(current)).toBe(JSON.stringify({ version: 6, entries: [] }));
    expect(store.getItem(oldKey)).toBe(raw);
  });
  it('isolates channels during migration and preserves unreadable originals before backup recovery is saved', () => {
    const store = storage();
    vi.stubEnv('VITE_RELEASE_CHANNEL', 'main');
    store.setItem(channelStorageKey('edu-circuit:measurement-notebook:v5'), legacyNotebook());
    vi.stubEnv('VITE_RELEASE_CHANNEL', 'dev');
    expect(loadMeasurementNotebook(store)).toEqual({ entries: [] });
    const entries = [entry()];
    expect(saveMeasurementNotebook(entries, store)).toBe(true);
    expect(saveMeasurementNotebook(entries, store)).toBe(true);
    const key = channelStorageKey('edu-circuit:measurement-notebook:v6');
    store.setItem(key, '{broken');
    const blocked = {
      ...store,
      setItem: (name: string, value: string) => {
        if (name.includes('originals')) throw new Error('quota');
        store.setItem(name, value);
      },
    };
    expect(saveMeasurementNotebook([], blocked)).toBe(false);
    expect(store.getItem(key)).toBe('{broken');
    expect(saveMeasurementNotebook([], store)).toBe(true);
    expect(
      JSON.parse(
        store.getItem(channelStorageKey('edu-circuit:measurement-notebook:originals:v1'))!,
      ),
    ).toContain('{broken');
  });
});
