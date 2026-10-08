import { describe, expect, it } from 'vitest';
import { createComponent, componentValue, componentPresentation, componentValueFontSize } from '../src/component-library';
import { createSvgExport } from '../src/export';
import {
  emptyDocument,
  diodeProfileRef,
  operatingProfileFor,
  requireDocument,
  validateDocument,
  type DiodeKind,
  type SimulationResult,
} from '../src/domain';
import { compileCircuit } from '../src/connectivity';
import { assessOperatingPoint, solveCircuit } from '../src/simulation';
import {
  copySelection,
  createHistory,
  executeCommand,
  executeCommands,
  undo,
  redo,
  type Command,
} from '../src/editor';
import {
  parseDocument,
  serializeDocument,
  saveMeasurementNotebook,
  loadMeasurementNotebook,
} from '../src/persistence';
import { createMeasurementRecord } from '../src/measurement';
import { analyze } from '../src/app/analyze';
import { measurementConditionKey } from '../src/app/measurement-records';
import fixture from '../fixtures/FIX-13-forward-diode.json';
import * as q from '../src/rational';

function circuit(kind: DiodeKind, resistance = 1000) {
  const doc = requireDocument(fixture.document);
  doc.components.find((c) => c.id === 'D1')!.operatingProfile = diodeProfileRef(kind);
  doc.components.find((c) => c.id === 'R1')!.properties.resistanceOhm = q.store(resistance);
  return doc;
}

describe('diode kinds', () => {
  it.each(['signal', 'power'] as const)('shows a small %s kind label and defaults output to hidden without changing saved settings', kind => {
    const doc = circuit(kind), diode = doc.components.find(c => c.id === 'D1')!;
    const name = kind === 'signal' ? '신호용' : '대전류용';
    expect(componentValue(diode, { mode: 'plain' })).toBe(name);
    for (const rotation of [0, 90] as const) {
      diode.rotation = rotation;
      expect(componentValueFontSize(doc.components, diode, name, 21)).toBe(10.5);
    }
    const before = serializeDocument(doc);
    expect(componentPresentation(diode).value).toBeNull();
    expect(createSvgExport(doc).content).not.toContain('data-output-id="D1" data-output-part="value"');
    expect(createSvgExport(doc, { circuitOnly: true }).content).toContain(name);
    expect(serializeDocument(doc)).toBe(before);
    diode.properties.answerVisible = true;
    const visible = createSvgExport(doc).content;
    expect(visible).toContain(name);
    expect(visible).not.toContain('700 mV');
    diode.properties.answerBlank = true;
    expect(componentPresentation(diode).value).toBe('□');
    diode.properties.answerVisible = false;
    expect(componentPresentation(diode).value).toBeNull();
    expect(createSvgExport(doc, { circuitOnly: true }).content).toContain(name);
    const restored = parseDocument(serializeDocument(doc));
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(componentPresentation(restored.document.components.find(c => c.id === 'D1')!).value).toBeNull();
  });

  it('creates a signal diode, round trips both kinds, copies them and rejects unknown or mismatched profiles', () => {
    expect(createComponent('diode', 'D1', { x: 0, y: 0 }).operatingProfile).toEqual(
      diodeProfileRef('signal'),
    );
    for (const kind of ['signal', 'power'] as const) {
      const doc = circuit(kind);
      expect(parseDocument(serializeDocument(doc))).toEqual({ ok: true, document: doc });
      let n = 0;
      const payload = copySelection(doc, ['D1'], (prefix) => `${prefix}${++n}`, { x: 100, y: 100 });
      const pasted = executeCommand(createHistory(doc), { type: 'Paste', ...payload });
      expect(pasted.ok).toBe(true);
      if (pasted.ok)
        expect(pasted.history.present.components.at(-1)!.operatingProfile).toEqual(
          diodeProfileRef(kind),
        );
      for (const ref of [
        { id: 'unknown', revision: 1 },
        { id: diodeProfileRef(kind).id, revision: 2 },
        { id: 'edu-source', revision: 1 },
      ]) {
        expect(
          validateDocument({
            ...doc,
            components: doc.components.map((c) =>
              c.id === 'D1' ? { ...c, operatingProfile: ref } : c,
            ),
          }).ok,
        ).toBe(false);
      }
      expect(
        validateDocument({
          ...doc,
          components: doc.components.map((c) =>
            c.id === 'R1' ? { ...c, operatingProfile: diodeProfileRef(kind) } : c,
          ),
        }).ok,
      ).toBe(false);
    }
  });

  it('preserves legacy signal data and atomically replaces kind and overrides with undo/redo', () => {
    const doc = requireDocument(fixture.document);
    const diode = doc.components.find((c) => c.id === 'D1')!;
    diode.operatingProfile = { id: 'edu-diode', revision: 1 };
    diode.properties.diodeThresholdV = q.store(q.rational(13n, 20n));
    diode.properties.diodeOnResistanceOhm = q.store(3);
    const initial = createHistory(doc);
    const unchanged = executeCommand(initial, { type: 'SetDiodeKind', id: 'D1', kind: 'signal' });
    expect(unchanged.ok && unchanged.history.present).toEqual(doc);
    const changed = executeCommands(initial, [
      { type: 'SetLabel', id: 'D1', label: '큰 다이오드' },
      { type: 'SetDiodeKind', id: 'D1', kind: 'power' },
    ]);
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.history.past).toHaveLength(1);
    const next = changed.history.present.components.find((c) => c.id === 'D1')!;
    expect(next).toMatchObject({
      label: '큰 다이오드',
      operatingProfile: diodeProfileRef('power'),
    });
    expect(next.properties).not.toHaveProperty('diodeThresholdV');
    expect(next.properties).not.toHaveProperty('diodeOnResistanceOhm');
    expect(undo(changed.history).present).toEqual(doc);
    expect(redo(undo(changed.history)).present).toEqual(changed.history.present);
    const implicit = { ...diode };
    delete implicit.operatingProfile;
    expect(operatingProfileFor(implicit)).toEqual(operatingProfileFor(diode));
    expect(operatingProfileFor(implicit)!.boundaries.reverseVoltage!.continuousMax).toEqual(
      q.from(30),
    );
  });

  it('rejects non-diode targets, invalid kinds and unauthorized batches without partial renaming', () => {
    const doc = circuit('signal');
    for (const command of [
      { type: 'SetDiodeKind', id: 'R1', kind: 'power' },
      { type: 'SetDiodeKind', id: 'missing', kind: 'power' },
      { type: 'SetDiodeKind', id: 'D1', kind: 'unknown' },
    ])
      expect(executeCommand(createHistory(doc), command as Command).ok).toBe(false);
    doc.activity = { allowedCommands: ['SetLabel', 'SetProperties'], revealSteps: [] };
    const history = createHistory(doc);
    expect(
      executeCommands(history, [
        { type: 'SetLabel', id: 'D1', label: '바꾸지 않음' },
        { type: 'SetDiodeKind', id: 'D1', kind: 'power' },
      ]).ok,
    ).toBe(false);
    expect(history.present).toEqual(doc);
  });

  it.each(['signal', 'power'] as const)(
    'keeps textbook 0.7 V while calculating %s characteristics and recording their identity',
    (kind) => {
      const doc = circuit(kind);
      const compiled = compileCircuit(doc).circuit;
      const textbook = solveCircuit(compiled);
      expect(textbook.componentVoltages.D1).toEqual(q.rational(7n, 10n));
      expect(textbook.branchCurrents.D1).toEqual(q.rational(43n, 10000n));
      const physical = solveCircuit(compiled, { physicalModel: 'component' });
      const resistance = kind === 'signal' ? q.from(2) : q.rational(1n, 20n);
      const current = q.div(q.rational(43n, 10n), q.add(q.from(1001), resistance));
      expect(physical.branchCurrents.D1).toEqual(current);
      expect(physical.componentVoltages.D1).toEqual(
        q.add(q.rational(7n, 10n), q.mul(current, resistance)),
      );
      expect(physical.provenance!.profileRevision).toContain(`${diodeProfileRef(kind).id}@1`);
      const record = createMeasurementRecord(doc, {
        quantity: 'voltage',
        value: q.store(physical.componentVoltages.D1),
        unit: 'V',
        source: 'simulation',
        condition: '정상 연결',
        targetIds: ['D1.a', 'D1.b'],
        provenance: physical.provenance,
      });
      expect(record.ok).toBe(true);
      if (!record.ok) return;
      const entry = {
        id: kind,
        record: record.value,
        note: '',
        sourcesDisconnected: false,
        anchors: {
          red: { kind: 'endpoint' as const, id: 'D1.a', endpointKind: 'terminal' as const },
          black: { kind: 'endpoint' as const, id: 'D1.b', endpointKind: 'terminal' as const },
          current: null,
        },
      };
      const data = new Map<string, string>();
      const store = {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => {
          data.set(key, value);
        },
      };
      expect(saveMeasurementNotebook([entry], store)).toBe(true);
      expect(loadMeasurementNotebook(store).entries).toEqual([entry]);
      expect(measurementConditionKey(entry)).not.toBe(
        measurementConditionKey({
          ...entry,
          record: {
            ...entry.record,
            documentSnapshot: circuit(kind === 'signal' ? 'power' : 'signal'),
          },
        }),
      );
    },
  );

  it('distinguishes both kinds in the same circuit without limiting current to a rating', () => {
    expect(analyze(circuit('signal', 1)).assessment.status).toBe('damage');
    expect(analyze(circuit('power', 1)).assessment.status).toBe('normal');
    const physical = solveCircuit(compileCircuit(circuit('power', 1)).circuit, {
      physicalModel: 'component',
    });
    expect(physical.branchCurrents.D1).toEqual(q.rational(86n, 41n));
    const direct = circuit('power', 0);
    direct.components.find((c) => c.id === 'V1')!.properties.voltageV = q.store(9);
    const assessed = analyze(direct);
    expect(q.compare(assessed.result.branchCurrents.D1, 6)).toBeGreaterThan(0);
    expect(assessed.assessment.components.some((c) => c.componentId === 'V1')).toBe(true);
  });

  it.each([
    [
      'signal',
      [
        [0.2, 0.75],
        [0.3, 1],
        [75, 100],
      ],
    ],
    [
      'power',
      [
        [6, 10],
        [6, 12],
        [1000, 1200],
      ],
    ],
  ] as const)(
    'includes the normal ceiling and damage floor for every %s boundary',
    (kind, expected) => {
      const doc = emptyDocument('boundaries');
      const diode = createComponent('diode', 'D1', { x: 0, y: 0 });
      diode.operatingProfile = diodeProfileRef(kind);
      doc.components.push(diode);
      const compiled = compileCircuit(doc).circuit;
      const profile = operatingProfileFor(diode)!;
      expect(
        ['forwardCurrent', 'power', 'reverseVoltage'].map((reason) => {
          const boundary = profile.boundaries[reason as keyof typeof profile.boundaries]!;
          return [boundary.continuousMax, boundary.damageAt];
        }),
      ).toEqual(expected.map((pair) => pair.map(q.from)));
      for (const reason of ['forwardCurrent', 'power', 'reverseVoltage'] as const) {
        const boundary = profile.boundaries[reason]!;
        for (const [value, status] of [
          [boundary.continuousMax, 'normal'],
          [q.add(boundary.continuousMax, q.rational(1n, 100000n)), 'overload'],
          [boundary.damageAt, 'damage'],
        ] as const) {
          const result: SimulationResult = {
            status: 'solved',
            nodeVoltages: {},
            branchCurrents: { D1: reason === 'forwardCurrent' ? value : q.ZERO },
            componentVoltages: { D1: reason === 'reverseVoltage' ? q.neg(value) : q.ZERO },
            componentPowers: { D1: reason === 'power' ? value : q.ZERO },
            diagnostics: [],
          };
          expect(assessOperatingPoint(compiled, result).status).toBe(status);
        }
      }
    },
  );
});
