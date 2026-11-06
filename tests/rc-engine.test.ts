import { describe, expect, it } from 'vitest';
import {
  emptyDocument,
  rcPolicy,
  validateDocument,
  type CircuitDocument,
  type RcResult,
  type RcFrame,
  type RcPlan,
  type RcPrepareRequest,
  type Rational,
} from '../src/domain';
import { compileCircuit } from '../src/connectivity';
import { rcEngine, rcCircuitRevision, rcInitialState, solveCircuit } from '../src/simulation';
import { createComponent } from '../src/component-library';
import { createMeasurementRecord, measurementsToCsv } from '../src/measurement';
import * as q from '../src/rational';
import references from './fixtures/rc-prototype-reference.json';
import type { RcCircuit } from '../tools/rc-prototype';

function ok<T>(result: RcResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}
function rational(text: string): Rational {
  const parts = text.split('/');
  return parts.length === 2 ? q.rational(BigInt(parts[0]), BigInt(parts[1])) : q.fromDecimal(text)!;
}
/** Converts oracle topology into a real v7 document; product compiler is always exercised. */
function document(input: RcCircuit): CircuitDocument {
  const doc = emptyDocument('rc-engine-test');
  doc.junctions = input.nodes.map((id, index) => ({
    id: `n:${id}`,
    position: { x: index * 150, y: 0 },
  }));
  doc.referenceNode = input.reference ? { kind: 'junction', id: `n:${input.reference}` } : null;
  for (const [index, e] of input.elements.entries()) {
    const c = createComponent(e.kind === 'voltage' ? 'dc-voltage-source' : e.kind, e.id, {
      x: index * 50,
      y: 100,
    });
    if (e.kind === 'switch') c.properties.state = e.closed ? 'closed' : 'open';
    else
      c.properties[
        e.kind === 'capacitor'
          ? 'capacitanceF'
          : e.kind === 'voltage'
            ? 'voltageV'
            : 'resistanceOhm'
      ] = q.store(rational(e.value));
    if (e.kind === 'capacitor')
      c.properties.initialVoltageV = q.store(rational(input.initialVoltages?.[e.id] ?? '0'));
    doc.components.push(c);
    for (const [i, node] of [e.a, e.b].entries())
      doc.wires.push({
        id: `w:${e.id}:${i}`,
        start: { kind: 'terminal', id: c.terminals[i].id },
        end: { kind: 'junction', id: `n:${node}` },
        waypoints: [],
      });
  }
  expect(validateDocument(doc).ok).toBe(true);
  return doc;
}
function request(doc: CircuitDocument): RcPrepareRequest {
  const { circuit, diagnostics } = compileCircuit(doc);
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return {
    circuit,
    initialState: rcInitialState(circuit),
    circuitRevision: rcCircuitRevision(circuit),
    operationIndex: 0,
    transition: 'initial',
    policy: rcPolicy,
  };
}
const series = (r = '10000', c = '0.0001', voltage = '10', initial = '0') =>
  document({
    nodes: ['g', 's', 'a'],
    reference: 'g',
    initialVoltages: { C: initial },
    elements: [
      { id: 'V', kind: 'voltage', a: 's', b: 'g', value: voltage },
      { id: 'R', kind: 'resistor', a: 's', b: 'a', value: r },
      { id: 'C', kind: 'capacitor', a: 'a', b: 'g', value: c },
    ],
  });
const prepare = (doc: CircuitDocument) => ok(rcEngine.prepare(request(doc)));
const frame = (plan: RcPlan, time: number | 'equilibrium') =>
  ok(
    rcEngine.sample(
      plan,
      time === 'equilibrium' ? { kind: time } : { kind: 'finite', seconds: time },
    ),
  );
function unique(result: ReturnType<typeof rcEngine.queryCurrent>): Rational {
  if (result.status !== 'unique') throw new Error(JSON.stringify(result));
  return result.value;
}
function contains(actual: Rational, expected: string) {
  const distance = q.abs(
    q.sub({ numerator: actual.numerator, denominator: actual.denominator }, rational(expected)),
  );
  // Exact binary64 error radius + independent Decimal(90) oracle remainder.
  const radius = q.add(
    rational(String(actual.approximation?.absoluteError ?? 0)),
    rational('1e-65'),
  );
  expect(
    q.compare(distance, radius),
    `${q.toNumber(actual)} must contain ${expected}`,
  ).toBeLessThanOrEqual(0);
}

describe('C2 public RC engine and compiled circuits', () => {
  it('calculates charging/discharging, certified readings and finite vs equilibrium states', () => {
    for (const [voltage, initial] of [
      ['10', '0'],
      ['0', '10'],
    ]) {
      const req = request(series('10000', '0.0001', voltage, initial)),
        plan = ok(rcEngine.prepare(req));
      expect(plan.summary.settlingTimeSeconds).toBeCloseTo(Math.log(1000), 3);
      expect(plan.summary.slowestTimeConstantSeconds).toBeCloseTo(1, 12);
      expect(frame(plan, 0).quality).toBe('exact');
      for (const t of [0, 0.01, 0.1, 1, 3, plan.summary.settlingTimeSeconds, 30]) {
        const f = frame(plan, t),
          expected = Number(voltage) + (Number(initial) - Number(voltage)) * Math.exp(-t);
        expect(q.toNumber(f.componentVoltages.C)).toBeCloseTo(expected, 11);
        expect(q.toNumber(f.branchCurrents.C)).toBeCloseTo(
          (Number(voltage) - expected) / 10000,
          14,
        );
        expect(
          unique(
            rcEngine.queryCurrent(f, [
              { componentId: 'R', coefficient: 1 },
              { componentId: 'C', coefficient: -1 },
            ]),
          ),
        ).toEqual(q.ZERO);
        expect(unique(rcEngine.queryWireCurrent(f, 'w:C:0'))).toEqual(q.neg(f.branchCurrents.C));
        const pair = rcEngine.queryVoltage(
          f,
          req.circuit.endpointToNet['n:a'],
          req.circuit.endpointToNet['n:g'],
        );
        expect(q.toNumber(unique(pair))).toBeCloseTo(expected, 11);
        if (t > 0)
          expect(f.componentVoltages.C.approximation).toMatchObject({
            reason: 'rc-modal',
            policy: 'rc-modal-1',
          });
      }
      const end = frame(plan, 'equilibrium');
      expect(end.quality).toBe('exact');
      expect(end.context.time).toEqual({ kind: 'equilibrium' });
      expect(end.componentVoltages.C).toEqual(rational(voltage));
      expect(end.branchCurrents.C).toEqual(q.ZERO);
      const tail = frame(plan, plan.summary.settlingTimeSeconds);
      expect(Math.abs(q.toNumber(tail.componentVoltages.C) - Number(voltage))).toBeLessThanOrEqual(
        0.010001,
      );
      expect(tail.componentVoltages.C).not.toEqual(end.componentVoltages.C);
    }
  });
  it.each(references.cases)(
    'encloses independent 90-digit multi-RC reference: $name',
    (reference) => {
      const doc = document(reference.circuit as unknown as RcCircuit),
        req = request(doc),
        plan = ok(rcEngine.prepare(req));
      for (const expected of reference.samples) {
        const f = frame(plan, Number(expected.time));
        const potentials: Record<string, Rational> = { g: q.ZERO };
        for (const element of reference.circuit.elements)
          if (element.kind === 'voltage') potentials[element.a] = rational(element.value);
        for (const [id, value] of Object.entries(expected.nodeVoltages))
          potentials[id] = rational(value);
        for (const element of reference.circuit.elements) {
          const voltage = q.sub(potentials[element.a], potentials[element.b]);
          contains(f.componentVoltages[element.id], q.exactText(voltage));
          if (element.kind === 'capacitor')
            contains(
              f.capacitorCharges[element.id],
              q.exactText(q.mul(voltage, rational(element.value))),
            );
        }
        for (const [id, value] of Object.entries(expected.currents))
          contains(f.branchCurrents[id], value);
        for (const [id, value] of Object.entries(expected.nodeVoltages))
          contains(f.nodeVoltages[req.circuit.endpointToNet[`n:${id}`]], value);
      }
    },
  );
  it('preserves floating conductor charge and isolated capacitor voltage', () => {
    const doc = document({
      nodes: ['g', 's', 'a', 'b'],
      reference: 'g',
      initialVoltages: { C1: '1', C2: '3' },
      elements: [
        { id: 'V', kind: 'voltage', a: 's', b: 'g', value: '10' },
        { id: 'R', kind: 'resistor', a: 's', b: 'a', value: '1' },
        { id: 'C1', kind: 'capacitor', a: 'a', b: 'b', value: '1' },
        { id: 'C2', kind: 'capacitor', a: 'b', b: 'g', value: '1' },
      ],
    });
    const plan = prepare(doc);
    expect(plan.summary.equilibriumState.map((s) => q.toNumber(s.voltageV))).toEqual([4, 6]);
    for (const t of [0, 0.1, 1, 10]) {
      const f = frame(plan, t);
      expect(q.toNumber(q.sub(f.capacitorCharges.C2, f.capacitorCharges.C1))).toBeCloseTo(2, 12);
    }
    const isolated = prepare(
      document({
        nodes: ['a', 'b'],
        initialVoltages: { C: '7' },
        elements: [{ id: 'C', kind: 'capacitor', a: 'a', b: 'b', value: '2' }],
      }),
    );
    expect(isolated.summary.settlingTimeSeconds).toBe(0);
    expect(frame(isolated, 1e100).capacitorCharges.C).toEqual(q.from(14));
  });
  it('maps equilibrium state by capacitor/terminal IDs through new topology and rejects impulses', () => {
    const doc = series(),
      charged = prepare(doc),
      end = frame(charged, 'equilibrium');
    const resistor = doc.components.find((c) => c.id === 'R')!;
    resistor.properties.resistanceOhm = q.store(20000);
    const next = request(doc);
    next.transition = 'operation';
    next.operationIndex = 1;
    next.initialState = end.capacitorState;
    expect(ok(rcEngine.prepare(next)).summary.settlingTimeSeconds).toBe(0);
    doc.components.find((c) => c.id === 'V')!.properties.voltageV = q.store(0);
    const discharge = {
      ...request(doc),
      transition: 'operation' as const,
      operationIndex: 2,
      initialState: end.capacitorState,
    };
    const plan = ok(rcEngine.prepare(discharge));
    expect(frame(plan, 0).componentVoltages.C).toEqual(q.from(10));
    expect(q.toNumber(frame(plan, 2).componentVoltages.C)).toBeCloseTo(10 / Math.E, 11);
    const state = end.capacitorState[0];
    const flipped = {
      ...discharge,
      initialState: [
        {
          ...state,
          aTerminalId: state.bTerminalId,
          bTerminalId: state.aTerminalId,
          voltageV: q.neg(state.voltageV),
        },
      ],
    };
    expect(frame(ok(rcEngine.prepare(flipped)), 2)).toEqual(frame(plan, 2));
    resistor.properties.resistanceOhm = q.store(0);
    expect(
      rcEngine.prepare({
        ...request(doc),
        transition: 'operation',
        operationIndex: 3,
        initialState: end.capacitorState,
      }),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'RC_IMPULSE_REQUIRED' }] });
    expect(frame(charged, 'equilibrium')).toEqual(end);
  });
  it('computes SPDT charging/discharging with the inactive contact carrying zero', () => {
    const doc = series();
    const sw = createComponent('changeover-switch', 'S', { x: 100, y: 0 });
    doc.components.push(sw);
    const [common, a, b] = ['common', 'throw-a', 'throw-b'].map(
      (role) => sw.terminals.find((t) => t.role === role)!.id,
    );
    doc.wires.find((w) => w.id === 'w:R:0')!.end = { kind: 'terminal', id: common };
    doc.wires.push(
      {
        id: 'wa',
        start: { kind: 'terminal', id: a },
        end: { kind: 'junction', id: 'n:s' },
        waypoints: [],
      },
      {
        id: 'wb',
        start: { kind: 'terminal', id: b },
        end: { kind: 'junction', id: 'n:g' },
        waypoints: [],
      },
    );
    const charged = prepare(doc);
    expect(frame(charged, 0).wireCurrents.wb).toEqual(q.ZERO);
    sw.properties.state = 'b';
    const next = {
      ...request(doc),
      transition: 'operation' as const,
      operationIndex: 1,
      initialState: charged.summary.equilibriumState,
    };
    const plan = ok(rcEngine.prepare(next));
    expect(q.toNumber(frame(plan, 1).componentVoltages.C)).toBeCloseTo(10 / Math.E, 11);
    expect(frame(plan, 1).wireCurrents.wa).toEqual(q.ZERO);
  });
  it('distinguishes ideal-current cycles from uniquely determined sums and wire cuts', () => {
    const doc = series('1', '1');
    const source = structuredClone(doc.components.find((c) => c.id === 'V')!);
    source.id = 'V2';
    source.terminals.forEach((t) => {
      t.id = `V2:${t.role}`;
    });
    doc.components.push(source);
    for (const [i, node] of ['s', 'g'].entries())
      doc.wires.push({
        id: `w:V2:${i}`,
        start: { kind: 'terminal', id: source.terminals[i].id },
        end: { kind: 'junction', id: `n:${node}` },
        waypoints: [],
      });
    const f = frame(prepare(doc), 1);
    expect(f.undefinedCurrentIds).toEqual(['V', 'V2']);
    expect(rcEngine.queryCurrent(f, [{ componentId: 'V', coefficient: 1 }])).toEqual({
      status: 'undefined',
      reason: 'nonunique',
    });
    expect(
      q.toNumber(
        unique(
          rcEngine.queryCurrent(f, [
            { componentId: 'V', coefficient: 1 },
            { componentId: 'V2', coefficient: 1 },
          ]),
        ),
      ),
    ).toBeCloseTo(-10 / Math.E, 11);
    expect(
      unique(
        rcEngine.queryCurrent(f, [
          { componentId: 'V', coefficient: 1 },
          { componentId: 'V2', coefficient: 1 },
          { componentId: 'C', coefficient: 1 },
        ]),
      ),
    ).toEqual(q.ZERO);
    expect(rcEngine.queryWireCurrent(f, 'w:V:0')).toEqual({
      status: 'undefined',
      reason: 'nonunique',
    });
    const duplicate = {
      ...structuredClone(doc.wires.find((w) => w.id === 'w:R:1')!),
      id: 'wire-cycle',
    };
    doc.wires.push(duplicate);
    const cycle = frame(prepare(doc), 0.5);
    expect(rcEngine.queryWireCurrent(cycle, 'wire-cycle')).toEqual({
      status: 'undefined',
      reason: 'nonunique',
    });
    expect(cycle.branchCurrents.C).toBeDefined();
  });
  it('uses dynamic reference groups, open voltmeters and ideal ammeters without leakage', () => {
    const doc = series();
    const vm = createComponent('voltmeter', 'VM', { x: 0, y: 0 }),
      am = createComponent('ammeter', 'AM', { x: 0, y: 0 });
    doc.components.push(vm, am);
    doc.wires.find((w) => w.id === 'w:R:1')!.end = { kind: 'terminal', id: am.terminals[0].id };
    doc.wires.push({
      id: 'wam',
      start: { kind: 'terminal', id: am.terminals[1].id },
      end: { kind: 'junction', id: 'n:a' },
      waypoints: [],
    });
    doc.wires.push({
      id: 'wvm',
      start: { kind: 'terminal', id: vm.terminals[0].id },
      end: { kind: 'junction', id: 'n:g' },
      waypoints: [],
    });
    const req = request(doc),
      f = frame(ok(rcEngine.prepare(req)), 1);
    expect(f.referenceGroups).toHaveLength(2);
    expect(
      rcEngine.queryVoltage(
        f,
        req.circuit.endpointToNet[vm.terminals[1].id],
        req.circuit.endpointToNet['n:g'],
      ),
    ).toEqual({ status: 'undefined', reason: 'independent-reference' });
    expect(f.branchCurrents.VM).toEqual(q.ZERO);
    expect(q.toNumber(f.branchCurrents.AM)).toBeCloseTo(q.toNumber(f.branchCurrents.C), 14);
    expect(f.undefinedVoltageIds).toContain('VM');
  });
  it('has deterministic identities, immutable plans/frames and no sample-history dependence', () => {
    const doc = series(),
      req = request(doc),
      plan = ok(rcEngine.prepare(req)),
      baseline = frame(plan, 1);
    doc.components.reverse();
    doc.wires.reverse();
    doc.junctions.reverse();
    doc.components.forEach((c) => {
      if (c.type === 'capacitor') c.terminals.reverse();
      c.rotation = 180;
    });
    const reversed = request(doc);
    expect(reversed.circuitRevision).toBe(req.circuitRevision);
    expect(frame(ok(rcEngine.prepare(reversed)), 1)).toEqual(baseline);
    expect(ok(rcEngine.sample(plan, { seconds: 1, kind: 'finite' }))).toEqual(baseline);
    expect(ok(rcEngine.sample(plan, { kind: 'finite', seconds: -0 }))).toEqual(frame(plan, 0));
    for (let i = 0; i < 120; i++) {
      const f = frame(plan, i / 60);
      rcEngine.queryCurrent(f, [{ componentId: 'C', coefficient: 1 }]);
    }
    expect(frame(plan, 1)).toEqual(baseline);
    expect(Object.isFrozen(plan.summary.equilibriumState[0].voltageV)).toBe(true);
    expect(Object.isFrozen(baseline.capacitorState[0])).toBe(true);
    req.circuit.elements.length = 0;
    expect(frame(plan, 1)).toEqual(baseline);
    expect(
      rcEngine.sample({ summary: plan.summary } as RcPlan, { kind: 'finite', seconds: 1 }),
    ).toMatchObject({ ok: false });
    expect(rcEngine.queryVoltage(structuredClone(baseline), 'a', 'b')).toMatchObject({
      status: 'error',
    });
  });
  it('rejects malformed requests, uncertified initial states and invalid time without throwing', () => {
    const valid = request(series()),
      plan = ok(rcEngine.prepare(valid));
    for (const change of [
      (r: RcPrepareRequest) => {
        r.circuitRevision = 'stale';
      },
      (r: RcPrepareRequest) => {
        delete r.circuit.wireCurrentTerms;
      },
      (r: RcPrepareRequest) => {
        r.initialState = [];
      },
      (r: RcPrepareRequest) => {
        r.initialState = [{ ...r.initialState[0], aTerminalId: 'wrong' }];
      },
      (r: RcPrepareRequest) => {
        r.operationIndex = -1;
      },
      (r: RcPrepareRequest) => {
        r.policy = { ...rcPolicy, relativeTolerance: 1 } as unknown as typeof rcPolicy;
      },
      (r: RcPrepareRequest) => {
        r.initialState = [
          {
            ...r.initialState[0],
            voltageV: {
              ...q.ZERO,
              approximation: { reason: 'rc-modal', policy: 'rc-modal-1', absoluteError: 1e-6 },
            },
          },
        ];
      },
    ]) {
      const req = structuredClone(valid);
      change(req);
      expect(rcEngine.prepare(req).ok).toBe(false);
    }
    for (const seconds of [-1, NaN, Infinity])
      expect(rcEngine.sample(plan, { kind: 'finite', seconds }).ok).toBe(false);
    expect(
      rcEngine.queryCurrent(frame(plan, 1), [{ componentId: 'C', coefficient: 0.5 }]),
    ).toMatchObject({ status: 'error' });
    expect(rcEngine.queryWireCurrent(frame(plan, 1), 'missing')).toEqual({
      status: 'undefined',
      reason: 'missing-target',
    });
  });
  it('reports initial/source conflicts and rejects even disconnected diode mixtures', () => {
    expect(rcEngine.prepare(request(series('0')))).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'RC_INITIAL_CONDITION_CONFLICT' }],
    });
    const doc = series();
    doc.components.push(createComponent('diode', 'D', { x: 0, y: 0 }));
    expect(rcEngine.prepare(request(doc))).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'RC_UNSUPPORTED_ELEMENT', affectedIds: ['D'] }],
    });
    const conflict = document({
      nodes: ['a', 'b'],
      elements: [
        { id: 'V1', kind: 'voltage', a: 'a', b: 'b', value: '1' },
        { id: 'V2', kind: 'voltage', a: 'a', b: 'b', value: '2' },
        { id: 'C', kind: 'capacitor', a: 'a', b: 'b', value: '1' },
      ],
    });
    expect(rcEngine.prepare(request(conflict))).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'RC_SOURCE_CONFLICT' }],
    });
    expect(solveCircuit(request(series()).circuit).diagnostics[0].code).toBe('RC_ENGINE_REQUIRED');
  });
  it('keeps small positive decay and sub-threshold changes distinct from equilibrium', () => {
    const slow = prepare(series('1e20', '1'));
    expect(slow.summary.settlingTimeSeconds).toBeGreaterThan(6e20);
    expect(q.toNumber(frame(slow, 1e20).componentVoltages.C)).toBeCloseTo(
      10 * (1 - 1 / Math.E),
      10,
    );
    const small = prepare(series('1e6', '1e-6', '1e-8'));
    expect(small.summary.settlingTimeSeconds).toBe(0);
    expect(q.toNumber(frame(small, 1).componentVoltages.C)).toBeGreaterThan(0);
    expect(frame(small, 1).componentVoltages.C).not.toEqual(
      frame(small, 'equilibrium').componentVoltages.C,
    );
  });
  it('fails with structured budget/conditioning diagnostics instead of falling back to DC', () => {
    const req = request(series());
    req.circuit.elements[0].value = q.rational(1n << 4097n);
    expect(rcEngine.prepare(req)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'RC_BUDGET_EXCEEDED' }],
    });
    const doc = document({
      nodes: ['g', 'a', 'b'],
      reference: 'g',
      elements: [
        { id: 'A', kind: 'capacitor', a: 'a', b: 'g', value: '1' },
        { id: 'B', kind: 'capacitor', a: 'b', b: 'g', value: '1' },
        { id: 'X', kind: 'capacitor', a: 'a', b: 'b', value: '1e20' },
        { id: 'RA', kind: 'resistor', a: 'a', b: 'g', value: '1' },
        { id: 'RB', kind: 'resistor', a: 'b', b: 'g', value: '1' },
      ],
    });
    expect(rcEngine.prepare(request(doc))).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'RC_NUMERICAL_UNVERIFIED' }],
    });
  });
  it('preserves actual engine frame provenance through recording and CSV', () => {
    const doc = series(),
      plan = prepare(doc),
      capacitor = doc.components.find((c) => c.id === 'C')!;
    for (const time of [1, 'equilibrium'] as const) {
      const f = frame(plan, time),
        record = createMeasurementRecord(doc, {
          condition: 'RC',
          source: 'simulation',
          quantity: 'voltage',
          unit: 'V',
          targetIds: capacitor.terminals.map((t) => t.id),
          value: q.store(f.componentVoltages.C),
          recordedAt: '2026-10-22T00:00:00Z',
          transient: f.context,
        });
      if (!record.ok) throw new Error(JSON.stringify(record.diagnostics));
      expect(record.value.quality).toBe(f.quality);
      expect(measurementsToCsv([record.value]).ok).toBe(true);
    }
  });
  it('preserves physical readings under reference changes and keeps the explicit ideal RC model', () => {
    const doc = series(),
      original = frame(prepare(doc), 1),
      originalRevision = request(doc).circuitRevision;
    doc.components.find((c) => c.id === 'V')!.properties.sourceResistanceOhm = q.store(100000);
    expect(request(doc).circuitRevision).toBe(originalRevision);
    expect(frame(prepare(doc), 1)).toEqual(original);
    doc.components.find((c) => c.id === 'R')!.type = 'resistive-load';
    doc.referenceNode = { kind: 'junction', id: 'n:a' };
    const shifted = frame(prepare(doc), 1);
    for (const [map, other] of [
      [original.componentVoltages, shifted.componentVoltages],
      [original.branchCurrents, shifted.branchCurrents],
      [original.capacitorCharges, shifted.capacitorCharges],
    ]) {
      for (const id of Object.keys(map)) {
        const difference = Math.abs(q.toNumber(map[id]) - q.toNumber(other[id]));
        expect(difference).toBeLessThanOrEqual(
          (map[id].approximation?.absoluteError ?? 0) +
            (other[id].approximation?.absoluteError ?? 0),
        );
      }
    }
  });
  it.each([8, 16, 32, 33])(
    'enforces deterministic size/arithmetic budgets on a %i-stage product circuit',
    (count) => {
      const input: RcCircuit = {
        nodes: ['g', 's', ...Array.from({ length: count }, (_, i) => `n${i}`)],
        reference: 'g',
        elements: [{ id: 'V', kind: 'voltage', a: 's', b: 'g', value: '10' }],
      };
      for (let i = 0; i < count; i++)
        input.elements.push(
          { id: `R${i}`, kind: 'resistor', a: i ? `n${i - 1}` : 's', b: `n${i}`, value: '1' },
          { id: `C${i}`, kind: 'capacitor', a: `n${i}`, b: 'g', value: '1' },
        );
      const req = request(document(input)),
        result = rcEngine.prepare(req);
      if (count <= 16) {
        const plan = ok(result);
        for (let i = 0; i <= 10; i++)
          expect(
            frame(plan, (plan.summary.settlingTimeSeconds * i) / 10).branchCurrents.C0,
          ).toBeDefined();
      } else {
        expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'RC_BUDGET_EXCEEDED' }] });
      }
    },
  );
  it('conserves charge and accounts for resistor energy during redistribution', () => {
    const plan = prepare(
      document({
        nodes: ['g', 'a', 'b'],
        reference: 'g',
        initialVoltages: { A: '10', B: '0' },
        elements: [
          { id: 'A', kind: 'capacitor', a: 'a', b: 'g', value: '1' },
          { id: 'B', kind: 'capacitor', a: 'b', b: 'g', value: '1' },
          { id: 'R', kind: 'resistor', a: 'a', b: 'b', value: '2' },
        ],
      }),
    );
    for (const t of [0, 0.1, 1, 4]) {
      const f = frame(plan, t),
        va = q.toNumber(f.componentVoltages.A),
        vb = q.toNumber(f.componentVoltages.B);
      expect(q.toNumber(q.add(f.capacitorCharges.A, f.capacitorCharges.B))).toBeCloseTo(10, 11);
      expect(50 - (va * va + vb * vb) / 2).toBeCloseTo(25 * (1 - Math.exp(-2 * t)), 10);
      expect(
        unique(
          rcEngine.queryCurrent(f, [
            { componentId: 'A', coefficient: 1 },
            { componentId: 'B', coefficient: 1 },
          ]),
        ),
      ).toEqual(q.ZERO);
    }
    expect(frame(plan, 'equilibrium').componentVoltages.A).toEqual(q.from(5));
  });
  it('prepares a shared wire cut whose constituent source currents are individually undefined', () => {
    const doc = series('1', '1');
    const v2 = structuredClone(doc.components.find((c) => c.id === 'V')!);
    v2.id = 'V2';
    v2.terminals.forEach((t) => {
      t.id = `V2:${t.role}`;
    });
    doc.components.push(v2);
    doc.junctions.push({ id: 'bus', position: { x: 0, y: 0 } });
    doc.wires.find((w) => w.id === 'w:V:0')!.end = { kind: 'junction', id: 'bus' };
    doc.wires.push(
      {
        id: 'v2+',
        start: { kind: 'terminal', id: v2.terminals[0].id },
        end: { kind: 'junction', id: 'bus' },
        waypoints: [],
      },
      {
        id: 'v2-',
        start: { kind: 'terminal', id: v2.terminals[1].id },
        end: { kind: 'junction', id: 'n:g' },
        waypoints: [],
      },
      {
        id: 'supply',
        start: { kind: 'junction', id: 'bus' },
        end: { kind: 'junction', id: 'n:s' },
        waypoints: [],
      },
    );
    const req = request(doc),
      plan = ok(rcEngine.prepare(req));
    expect(req.circuit.wireCurrentTerms!.supply).toEqual([
      { componentId: 'V', coefficient: -1 },
      { componentId: 'V2', coefficient: -1 },
    ]);
    for (const t of [0, 1, plan.summary.settlingTimeSeconds]) {
      const f = frame(plan, t);
      expect(q.toNumber(unique(rcEngine.queryWireCurrent(f, 'supply')))).toBeCloseTo(
        10 * Math.exp(-t),
        10,
      );
    }
  });
});
