import * as q from '../src/rational';
import { describe, expect, it } from 'vitest';
import { examples } from '../src/fixtures';
import { endpointName, wireName } from '../src/component-library';
import { createMeasurementRecord } from '../src/measurement';
import {
  loadMeasurementNotebook,
  saveMeasurementNotebook,
  type MeasurementEntry,
} from '../src/persistence';
import {
  measurementConditions,
  measurementLocation,
  measurementDirection,
  measurementTableHtml,
  measurementTableText,
  measurementValue,
} from '../src/app/measurement-records';

function entry(id = 'one'): MeasurementEntry {
  const doc = structuredClone(examples.find((e) => e.id === 'FIX-02')!.document);
  const record = createMeasurementRecord(doc, {
    condition: '정상 연결',
    source: 'simulation',
    quantity: 'voltage',
    value: q.store(3),
    unit: 'V',
    targetIds: ['R1.a', 'R1.b'],
  });
  if (!record.ok) throw new Error('Fixture invalid');
  return { id, record: record.value, note: '', sourcesDisconnected: false, anchors: { red: { kind: 'endpoint', id: 'R1.a', endpointKind: 'terminal' }, black: { kind: 'endpoint', id: 'R1.b', endpointKind: 'terminal' }, current: null } };
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
describe('measurement notebook', () => {
  it('uses visible component names for junctions, wire records and copied locations', () => {
    const saved = entry();
    const doc = saved.record.documentSnapshot;
    doc.junctions[0].id = 'Jm';
    for (const wire of doc.wires)
      for (const end of [wire.start, wire.end]) if (end.id === 'J1') end.id = 'Jm';
    saved.record.targetIds = ['Jm', 'R1.a'];
    saved.record.value = q.store(-3);
    const before = JSON.stringify(doc);
    const r1 = doc.components.find((c) => c.id === 'R1')!.label;
    const r2 = doc.components.find((c) => c.id === 'R2')!.label;
    expect(endpointName(doc, 'Jm')).toBe(`${r1}·${r2} 사이 연결점`);
    expect(wireName(doc, 'W2')).toBe(`${r1} 오른쪽 도선`);
    expect(measurementLocation(saved)).toContain('사이 연결점');
    expect(measurementDirection(saved)).not.toContain('Jm');
    expect(measurementTableText([saved])).not.toMatch(/Jm|W2/);
    const current = {
      ...saved,
      record: { ...saved.record, quantity: 'current' as const, targetIds: ['W2'] },
    };
    expect(measurementLocation(current)).toBe(`${r1} 오른쪽 도선`);
    expect(JSON.stringify(doc)).toBe(before);
    doc.wires = doc.wires.filter((wire) => wire.id !== 'W3');
    const resistor = doc.components.find((c) => c.id === 'R1')!;
    for (const [rotation, side] of [[0, '오른쪽'], [90, '아래쪽'], [180, '왼쪽'], [270, '위쪽']] as const) {
      resistor.rotation = rotation;
      expect(endpointName(doc, 'Jm')).toBe(`${r1} ${side} 연결점`);
    }
  });
  it('distinguishes supply-side junctions, handles isolated loops, and names rotated terminals correctly', () => {
    const parallel = structuredClone(examples.find((e) => e.id === 'FIX-03')!.document);
    expect(endpointName(parallel, 'JT')).toContain('＋극 쪽 연결점');
    expect(endpointName(parallel, 'JB')).toContain('−극 쪽 연결점');
    const r = parallel.components.find((c) => c.id === 'R1')!;
    r.rotation = 90;
    expect(endpointName(parallel, 'R1.a')).toBe(`${r.label} · 위쪽 단자`);
    parallel.junctions.push(
      { id: 'opaque-a', position: { x: 600, y: 0 } },
      { id: 'opaque-b', position: { x: 620, y: 0 } },
    );
    parallel.wires.push({
      id: 'opaque-wire',
      start: { kind: 'junction', id: 'opaque-a' },
      end: { kind: 'junction', id: 'opaque-b' },
      waypoints: [],
    });
    expect(endpointName(parallel, 'opaque-a')).toBe('연결점');
    expect(wireName(parallel, 'opaque-wire')).not.toContain('opaque');
    expect(endpointName(parallel, 'missing')).toBe('연결 위치');
  });
  it('round trips notes, direction, isolation and snapshots separately from circuit storage', () => {
    const store = storage(),
      voltage = entry(),
      current = entry('two'),
      resistance = entry('three');
    voltage.note = '첫 측정';
    current.record = {
      ...current.record,
      quantity: 'current',
      unit: 'A',
      value: q.store(-1),
      targetIds: ['R1'],
    };
    current.anchors = { red: null, black: null, current: { kind: 'component', id: 'R1' } };
    current.currentDirection = {
      from: { kind: 'terminal', id: 'R1.a' },
      to: { kind: 'terminal', id: 'R1.b' },
    };
    resistance.record = {
      ...resistance.record,
      quantity: 'resistance',
      unit: 'Ω',
      value: q.store(3),
      condition: '모든 전원 분리',
    };
    resistance.sourcesDisconnected = true;
    expect(saveMeasurementNotebook([voltage, current, resistance], store)).toBe(true);
    expect(loadMeasurementNotebook(store).entries).toEqual([voltage, current, resistance]);
    expect(measurementValue(current)).toBe('1 A');
    expect(measurementDirection(current)).toMatch(/오른쪽 단자.*→.*왼쪽 단자/);
    expect(store.data.has('edu-circuit:auto:v1')).toBe(false);
  });
  it('rejects old notebook versions and numeric values in current records', () => {
    for (const corrupt of [
      { version: 2, entries: [entry()] },
      { version: 4, entries: [entry()] },
      { version: 5, entries: [{ ...entry(), record: { ...entry().record, value: 1 / 3 } }] },
    ]) {
      const store = storage();
      store.data.set('edu-circuit:measurement-notebook:v5', JSON.stringify(corrupt));
      expect(loadMeasurementNotebook(store)).toMatchObject({ entries: [], warning: expect.any(String) });
    }
  });
  it('round trips physical model provenance and rejects malformed provenance', () => {
    const store = storage(), saved = entry();
    saved.record.provenance = { physicalModel: 'component', profileRevision: 'edu-source@1|edu-resistor@1', arithmeticQuality: 'exact' };
    expect(saveMeasurementNotebook([saved], store)).toBe(true);
    expect(loadMeasurementNotebook(store).entries).toEqual([saved]);
    for (const provenance of [null, 'component', { physicalModel: 'unknown', profileRevision: 'test', arithmeticQuality: 'exact' }]) {
      store.data.set('edu-circuit:measurement-notebook:v5', JSON.stringify({ version: 5, entries: [{ ...saved, record: { ...saved.record, provenance } }] }));
      expect(loadMeasurementNotebook(store)).toMatchObject({ entries: [], warning: expect.any(String) });
    }
  });
  it('recovers a valid backup, rejects unsupported versions and reports storage failure', () => {
    const store = storage(),
      first = entry();
    saveMeasurementNotebook([first], store);
    saveMeasurementNotebook([{ ...first, note: '수정' }], store);
    const key = [...store.data.keys()].find((key) => !key.endsWith(':backup'))!;
    store.data.set(key, '{broken');
    expect(loadMeasurementNotebook(store)).toMatchObject({
      entries: [first],
      warning: expect.any(String),
    });
    store.data.delete(`${key}:backup`);
    store.data.set(key, JSON.stringify({ version: 99, entries: [] }));
    expect(loadMeasurementNotebook(store)).toMatchObject({
      entries: [],
      warning: expect.any(String),
    });
    expect(
      saveMeasurementNotebook([first], {
        getItem: () => null,
        setItem: () => {
          throw new Error('quota');
        },
      }),
    ).toBe(false);
    expect(
      loadMeasurementNotebook({
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {},
      }).warning,
    ).toBeTruthy();
  });
  it('requires exact valid positions and does not load legacy notebooks', () => {
    const store = storage(), saved = entry();
    saved.record.targetIds = ['V1.p', 'R1.b'];
    saved.anchors.red = { kind: 'wire', id: 'W1', segment: 0, t: 0.23 };
    saved.anchors.black = { kind: 'wire', id: 'W2', segment: 0, t: 0.81 };
    expect(saveMeasurementNotebook([saved], store)).toBe(true);
    expect(loadMeasurementNotebook(store).entries[0].anchors).toEqual(saved.anchors);
    for (const invalid of [null, {kind:'wire',id:'W1',segment:99,t:0.23}, {kind:'wire',id:'W1',segment:0,t:1.2}, {kind:'wire',id:'W2',segment:0,t:0.23}]) {
      const broken = structuredClone(saved);
      broken.anchors.red = invalid as MeasurementEntry['anchors']['red'];
      expect(saveMeasurementNotebook([broken], storage())).toBe(false);
    }
    const legacy = storage();
    legacy.setItem('edu-circuit:measurement-notebook:v1', JSON.stringify({version:1,entries:[saved]}));
    expect(loadMeasurementNotebook(legacy)).toEqual({entries:[]});
  });
  it('separates electrical conditions while ignoring layout, labels, formatting and array order', () => {
    const first = entry(),
      moved = entry('two'),
      changed = entry('three'),
      detached = entry('four');
    moved.record.documentSnapshot.components.reverse();
    moved.record.documentSnapshot.wires.reverse();
    const resistor = moved.record.documentSnapshot.components.find((c) => c.id === 'R1')!;
    resistor.position.x += 80;
    resistor.label = '이름 변경';
    resistor.properties.quantityNotation = 'scientific';
    changed.record.documentSnapshot.components.find(
      (c) => c.id === 'R1',
    )!.properties.resistanceOhm = q.store(6);
    detached.sourcesDisconnected = true;
    expect(
      measurementConditions([first, moved, changed, detached]).map((group) => group.entries.length),
    ).toEqual([2, 1, 1]);
    changed.record.documentSnapshot = structuredClone(first.record.documentSnapshot);
    changed.record.documentSnapshot.wires.pop();
    expect(measurementConditions([first, changed])).toHaveLength(2);
  });
  it('exports readable conditions, targets, units and notes with safe text and HTML', () => {
    const saved = entry();
    saved.note = '=1+1\t<script>note</script>';
    const text = measurementTableText([saved]),
      html = measurementTableHtml([saved]);
    expect(text).toContain('측정 위치');
    expect(text).toContain('양단\t전압');
    expect(text).toContain('3 V');
    expect(text).toContain("'=1+1 <script>note</script>");
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    saved.record.value = q.store(-3);
    expect(measurementValue(saved)).toBe('-3 V');
    expect(measurementTableText([saved], ',')).toContain('"\'-3 V"');
  });
});
