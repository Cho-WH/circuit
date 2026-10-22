import { describe, expect, it } from 'vitest';
import {
  prepareRc,
  type RcCircuit,
  type RcPlan,
  type RcResult,
  type RcValue,
  defaultLimits,
} from '../tools/rc-prototype';
import { exactArithmetic } from '../tools/rc-prototype/exact';
import { decay } from '../tools/rc-prototype/interval';
import references from './fixtures/rc-prototype-reference.json';

function ok<T>(result: RcResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostic));
  return result.value;
}
const series = (r = '10000', c = '0.0001', voltage = '10', initial = '0'): RcCircuit => ({
  nodes: ['g', 's', 'a'],
  reference: 'g',
  initialVoltages: { C: initial },
  elements: [
    { id: 'V', kind: 'voltage', a: 's', b: 'g', value: voltage },
    { id: 'R', kind: 'resistor', a: 's', b: 'a', value: r },
    { id: 'C', kind: 'capacitor', a: 'a', b: 'g', value: c },
  ],
});
const frame = (plan: RcPlan, t: number | 'equilibrium') => ok(plan.sample(t));
function contains(value: RcValue, decimal: string) {
  const e = exactArithmetic({ ...defaultLimits, bits: 8192 });
  const error = e.q.abs(e.q.sub(e.fromFloat(value.value), e.parse(decimal)));
  // Oracle's 90-digit finite series remainder is well below this absolute margin.
  const radius = e.q.add(e.fromFloat(value.absoluteError), e.parse('1e-65'));
  expect(
    e.q.compare(error, radius),
    `${value.value} ± ${value.absoluteError} must contain ${decimal}`,
  ).toBeLessThanOrEqual(0);
}

describe('C0 RC prototype: analytic circuits and physical invariants', () => {
  it('matches charge/discharge formulas and finds the 0.1% tail instead of using a fixed delay', () => {
    for (const [v, initial] of [
      ['10', '0'],
      ['0', '10'],
    ]) {
      const plan = ok(prepareRc(series('10000', '0.0001', v, initial)));
      expect(plan.summary.settlingTime).toBeCloseTo(Math.log(1000), 3);
      for (const t of [0, 0.0001, 0.1, 1, 3, 7, 30]) {
        const result = frame(plan, t);
        const vc = Number(v) + (Number(initial) - Number(v)) * Math.exp(-t);
        expect(result.voltages.C.value).toBeCloseTo(vc, 11);
        expect(result.currents.C!.value).toBeCloseTo((Number(v) - vc) / 10000, 14);
        expect(result.currents.V!.value + result.currents.C!.value).toBeCloseTo(0, 15);
      }
      expect(frame(plan, 'equilibrium').currents.C!.exact).toBe('0/1');
      for (const ratio of [1, 1.01, 2, 10])
        expect(
          Object.values(ok(plan.remaining(plan.summary.settlingTime * ratio))).every(
            (x) => x.bound <= x.tolerance,
          ),
        ).toBe(true);
    }
  });
  it('preserves a floating middle conductor charge instead of assuming equal capacitor charges', () => {
    const circuit: RcCircuit = {
      nodes: ['g', 's', 'a', 'b'],
      reference: 'g',
      initialVoltages: { C1: '1', C2: '3' },
      elements: [
        { id: 'V', kind: 'voltage', a: 's', b: 'g', value: '10' },
        { id: 'R', kind: 'resistor', a: 's', b: 'a', value: '1' },
        { id: 'C1', kind: 'capacitor', a: 'a', b: 'b', value: '1' },
        { id: 'C2', kind: 'capacitor', a: 'b', b: 'g', value: '1' },
      ],
    };
    const plan = ok(prepareRc(circuit));
    expect(plan.summary.conservedStates).toBe(1);
    expect(plan.equilibriumVoltages()).toEqual({ C1: '4/1', C2: '6/1' });
    for (const t of [0, 0.01, 0.3, 2, 10]) {
      const f = frame(plan, t);
      expect(f.voltages.C1.value).toBeCloseTo(4 - 3 * Math.exp(-2 * t), 11);
      expect(f.charges.C2.value - f.charges.C1.value).toBeCloseTo(2, 12);
      expect(f.currents.C1!.value).toBeCloseTo(f.currents.C2!.value, 12);
    }
  });
  it('keeps isolated charge and supports charge redistribution through a resistor', () => {
    const isolated: RcCircuit = {
      nodes: ['a', 'b'],
      elements: [{ id: 'C', kind: 'capacitor', a: 'a', b: 'b', value: '2' }],
      initialVoltages: { C: '7' },
    };
    const plan = ok(prepareRc(isolated));
    expect(plan.summary.settlingTime).toBe(0);
    expect(frame(plan, 1e100).voltages.C.exact).toBe('7/1');
    expect(frame(ok(prepareRc({ ...isolated, reference: 'b' })), 5).voltages.C).toEqual(
      frame(plan, 5).voltages.C,
    );
    const network: RcCircuit = {
      nodes: ['g', 'a', 'b'],
      reference: 'g',
      initialVoltages: { A: '10', B: '0' },
      elements: [
        { id: 'A', kind: 'capacitor', a: 'a', b: 'g', value: '1' },
        { id: 'B', kind: 'capacitor', a: 'b', b: 'g', value: '3' },
        { id: 'R', kind: 'resistor', a: 'a', b: 'b', value: '1' },
      ],
    };
    const redistribution = ok(prepareRc(network));
    expect(redistribution.equilibriumVoltages()).toEqual({ A: '5/2', B: '5/2' });
    let energy = Infinity;
    for (const t of [0, 0.1, 0.5, 1, 10]) {
      const f = frame(redistribution, t),
        a = f.voltages.A.value,
        b = f.voltages.B.value;
      expect(f.charges.A.value + f.charges.B.value).toBeCloseTo(10, 11);
      const nextEnergy = (a * a + 3 * b * b) / 2;
      expect(nextEnergy).toBeLessThanOrEqual(energy);
      energy = nextEnergy;
      // Instantaneous power balance: resistor loss + d(stored energy)/dt = 0.
      expect((a - b) ** 2 + a * f.currents.A!.value + b * f.currents.B!.value).toBeCloseTo(0, 10);
    }
    expect(energy).toBeCloseTo(12.5, 7);
  });
  it('eliminates resistor-only algebraic nodes and handles dependent capacitors', () => {
    const base = series('1', '1');
    const circuit: RcCircuit = {
      ...base,
      nodes: [...base.nodes, 'm'],
      elements: [
        base.elements[0],
        { id: 'R1', kind: 'resistor', a: 's', b: 'm', value: '1' },
        { id: 'R2', kind: 'resistor', a: 'm', b: 'a', value: '1' },
        base.elements[2],
        { id: 'D', kind: 'capacitor', a: 'a', b: 'g', value: '1' },
      ],
    };
    const plan = ok(prepareRc(circuit));
    expect(plan.summary.states).toBe(1);
    expect(frame(plan, 4).voltages.C.value).toBeCloseTo(10 * (1 - Math.exp(-1)), 11);
    expect(frame(plan, 4).nodeVoltages.m.value).toBeCloseTo(
      (10 + frame(plan, 4).voltages.C.value) / 2,
      11,
    );
  });
  it('rejects inconsistent initial voltages and impulsive reconnection without leaking or mutating state', () => {
    const direct = series('0', '1', '10', '0');
    const original = JSON.stringify(direct);
    expect(prepareRc(direct)).toMatchObject({
      ok: false,
      diagnostic: { code: 'RC_INITIAL_CONDITION_CONFLICT' },
    });
    expect(prepareRc(direct, { transition: true })).toMatchObject({
      ok: false,
      diagnostic: { code: 'RC_IMPULSE_REQUIRED' },
    });
    expect(JSON.stringify(direct)).toBe(original);
    expect(frame(ok(prepareRc(series('0', '1', '10', '10'))), 5).voltages.C.exact).toBe('10/1');
  });
  it('keeps redundant ideal-source current undefined', () => {
    const circuit = series();
    circuit.elements.push({ id: 'V2', kind: 'voltage', a: 's', b: 'g', value: '10' });
    const f = frame(ok(prepareRc(circuit)), 1);
    expect(f.currents.V).toBeNull();
    expect(f.currents.V2).toBeNull();
    expect(f.currents.R!.value).toBeCloseTo(0.001 / Math.E, 13);
  });
  it('does not invent voltage across open switches joining independent reference groups', () => {
    const circuit = series();
    circuit.nodes.push('floating');
    circuit.elements.push({ id: 'S', kind: 'switch', a: 'a', b: 'floating', closed: false });
    const f = frame(ok(prepareRc(circuit)), 1);
    expect(f.voltages.S).toBeUndefined();
    expect(f.undefinedVoltages).toEqual(['S']);
    expect(f.currents.S!.exact).toBe('0/1');
  });
  it('resolves a switch transition by capacitor identity and preserves voltage across it', () => {
    const circuit = series('10000', '0.0001', '10', '0');
    circuit.elements.push({ id: 'S', kind: 'switch', a: 'a', b: 'g', closed: false });
    const plan = ok(prepareRc(circuit));
    circuit.initialVoltages = { ...plan.equilibriumVoltages() };
    circuit.elements[circuit.elements.length - 1] = {
      id: 'S',
      kind: 'switch',
      a: 'a',
      b: 'g',
      closed: true,
    };
    expect(prepareRc(circuit, { transition: true })).toMatchObject({
      ok: false,
      diagnostic: { code: 'RC_IMPULSE_REQUIRED' },
    });
    const discharge = series('10000', '0.0001', '0');
    discharge.initialVoltages = { ...plan.equilibriumVoltages() };
    expect(frame(ok(prepareRc(discharge, { transition: true })), 0).voltages.C.exact).toBe('10/1');
  });
  it('handles repeated decay rates without a distinct-eigenvalue assumption', () => {
    const circuit: RcCircuit = {
      nodes: ['g', 'a', 'b'],
      reference: 'g',
      initialVoltages: { A: '1', B: '2', X: '-1' },
      elements: [
        { id: 'A', kind: 'capacitor', a: 'a', b: 'g', value: '1' },
        { id: 'B', kind: 'capacitor', a: 'b', b: 'g', value: '1' },
        { id: 'X', kind: 'capacitor', a: 'a', b: 'b', value: '1' },
        { id: 'RA', kind: 'resistor', a: 'a', b: 'g', value: '1' },
        { id: 'RB', kind: 'resistor', a: 'b', b: 'g', value: '1' },
        { id: 'RX', kind: 'resistor', a: 'a', b: 'b', value: '1' },
      ],
    };
    const plan = ok(prepareRc(circuit));
    expect(plan.summary.rates[0]).toBeCloseTo(1, 12);
    expect(plan.summary.rates.every((rate) => Math.abs(rate - 1) < 1e-12)).toBe(true);
    contains(
      frame(plan, 1).voltages.A,
      '0.367879441171442321595523770161460867445811131031767834507836801697',
    );
    contains(
      frame(plan, 1).voltages.B,
      '0.735758882342884643191047540322921734891622262063535669015673603394',
    );
  });
  it('keeps terminal signs invariant under a physical direction reversal and consistent initial sign', () => {
    const original = series('2', '3', '10', '2');
    const reversed = series('2', '3', '10', '-2');
    reversed.elements[2] = { id: 'C', kind: 'capacitor', a: 'g', b: 'a', value: '3' };
    const p = ok(prepareRc(original)),
      r = ok(prepareRc(reversed));
    for (const t of [0, 1, 10]) {
      expect(frame(p, t).voltages.C.value).toBeCloseTo(-frame(r, t).voltages.C.value, 12);
      expect(frame(p, t).currents.C!.value).toBeCloseTo(-frame(r, t).currents.C!.value, 12);
      expect(frame(p, t).currents.R!.value).toBeCloseTo(frame(r, t).currents.R!.value, 12);
    }
  });
  it('reuses exact equilibrium state for the next event and avoids a fake response to a resistor-only change', () => {
    const charged = ok(prepareRc(series()));
    const next = series('20000');
    next.initialVoltages = { ...charged.equilibriumVoltages() };
    const unchanged = ok(prepareRc(next, { transition: true }));
    expect(unchanged.summary.settlingTime).toBe(0);
    next.elements[0] = { id: 'V', kind: 'voltage', a: 's', b: 'g', value: '0' };
    const discharge = ok(prepareRc(next, { transition: true }));
    expect(frame(discharge, 0).voltages.C.exact).toBe('10/1');
    expect(frame(discharge, 2).voltages.C.value).toBeCloseTo(10 / Math.E, 11);
  });
  it('is independent of previous sample calls and element order', () => {
    const circuit = series(),
      a = ok(prepareRc(circuit));
    const b = ok(
      prepareRc({
        ...circuit,
        nodes: [...circuit.nodes].reverse(),
        elements: [...circuit.elements].reverse(),
      }),
    );
    for (let t = 0; t < 3; t += 1 / 60) frame(a, t);
    expect(frame(a, 3)).toEqual(frame(b, 3));
    expect(a.summary).toEqual(b.summary);
  });
  it('does not truncate very small positive decay rates to zero', () => {
    const plan = ok(prepareRc(series('1e20', '1')));
    expect(plan.summary.decayingStates).toBe(1);
    expect(plan.summary.rates[0]).toBeGreaterThan(0);
    expect(plan.summary.settlingTime).toBeGreaterThan(6e20);
    expect(frame(plan, 1e20).voltages.C.value).toBeCloseTo(10 * (1 - 1 / Math.E), 10);
  });
  it('keeps a sub-threshold change nonzero and distinguishes finite time from equilibrium', () => {
    const plan = ok(prepareRc(series('1e6', '1e-6', '1e-8')));
    expect(plan.summary.settlingTime).toBe(0);
    expect(frame(plan, 0).voltages.C.exact).toBe('0/1');
    expect(frame(plan, 1).voltages.C.value).toBeGreaterThan(0);
    expect(frame(plan, 1).voltages.C.value).toBeLessThan(1e-8);
    expect(frame(plan, 1).time).toEqual({ kind: 'finite', seconds: 1 });
    expect(frame(plan, 'equilibrium').time).toEqual({ kind: 'equilibrium' });
    expect(plan.equilibriumVoltages().C).toBe('1/100000000');
  });
  it('preserves dynamic voltage differences and currents under a different reference', () => {
    const circuit = references.cases.find((c) => c.name === 'coupled-capacitor-mesh')!
      .circuit as unknown as RcCircuit;
    const a = ok(prepareRc(circuit)),
      b = ok(prepareRc({ ...circuit, reference: 'n1' }));
    for (const t of [0, 0.2, 3]) {
      const x = frame(a, t),
        y = frame(b, t);
      for (const id of Object.keys(x.voltages))
        expect(Math.abs(x.voltages[id].value - y.voltages[id].value)).toBeLessThanOrEqual(
          x.voltages[id].absoluteError + y.voltages[id].absoluteError,
        );
      for (const id of Object.keys(x.currents))
        expect(Math.abs(x.currents[id]!.value - y.currents[id]!.value)).toBeLessThanOrEqual(
          x.currents[id]!.absoluteError + y.currents[id]!.absoluteError,
        );
    }
  });
  it('fails closed when binary64 loses an exact positive energy mode', () => {
    const circuit: RcCircuit = {
      nodes: ['g', 'a', 'b'],
      reference: 'g',
      elements: [
        { id: 'A', kind: 'capacitor', a: 'a', b: 'g', value: '1' },
        { id: 'B', kind: 'capacitor', a: 'b', b: 'g', value: '1' },
        { id: 'X', kind: 'capacitor', a: 'a', b: 'b', value: '1e20' },
        { id: 'RA', kind: 'resistor', a: 'a', b: 'g', value: '1' },
        { id: 'RB', kind: 'resistor', a: 'b', b: 'g', value: '1' },
      ],
    };
    expect(prepareRc(circuit)).toMatchObject({
      ok: false,
      diagnostic: { code: 'RC_NUMERICAL_UNVERIFIED', detail: 'cholesky' },
    });
  });
  it('handles zero dynamic states and detects contradictory ideal voltage sources', () => {
    const circuit = series();
    circuit.elements = circuit.elements.filter((e) => e.kind !== 'capacitor');
    circuit.initialVoltages = {};
    const plan = ok(prepareRc(circuit));
    expect(plan.summary.states).toBe(0);
    expect(frame(plan, 1).currents.R!.exact).toBe('0/1');
    circuit.elements.push({ id: 'V2', kind: 'voltage', a: 's', b: 'g', value: '9' });
    expect(prepareRc(circuit)).toMatchObject({
      ok: false,
      diagnostic: { code: 'RC_SOURCE_CONFLICT' },
    });
  });
  it('reports exhausted budgets and unsupported input rather than returning equilibrium', () => {
    for (const limits of [
      { capacitors: 0 },
      { remainders: 0 },
      { bits: 2 },
      { searchExpansions: 0 },
    ])
      expect(prepareRc(series(), { limits })).toMatchObject({
        ok: false,
        diagnostic: { code: 'RC_BUDGET_EXCEEDED' },
      });
    expect(
      prepareRc({
        ...series(),
        elements: [{ id: 'D', kind: 'diode', a: 's', b: 'g', value: '0.7' }],
      } as unknown as RcCircuit),
    ).toMatchObject({ ok: false, diagnostic: { code: 'RC_UNSUPPORTED_ELEMENT' } });
    expect(prepareRc(series('1', '0'))).toMatchObject({
      ok: false,
      diagnostic: { code: 'RC_INVALID_INPUT' },
    });
    expect(prepareRc(series('1e999999'))).toMatchObject({
      ok: false,
      diagnostic: { code: 'RC_INVALID_INPUT' },
    });
  });
});

describe('C0 independently generated 90-digit reference circuits', () => {
  for (const reference of references.cases)
    it(
      reference.name,
      () => {
        const plan = ok(prepareRc(reference.circuit as unknown as RcCircuit));
        for (const sample of reference.samples) {
          const f = frame(plan, Number(sample.time));
          for (const [id, value] of Object.entries(sample.nodeVoltages))
            contains(f.nodeVoltages[id], value);
          for (const [id, value] of Object.entries(sample.currents))
            contains(f.currents[id]!, value);
          // Compare envelope with the independent oracle, not a second call to the same engine.
          const bounds = ok(plan.remaining(Number(sample.time)));
          const e = exactArithmetic(defaultLimits);
          for (const [id, value] of Object.entries(sample.nodeVoltages)) {
            const pair = `pair:${JSON.stringify(['g', id])}`;
            const error = e.q.abs(e.q.sub(e.parse('10'), e.parse(value)));
            expect(
              e.q.compare(error, e.q.add(e.fromFloat(bounds[pair].bound), e.parse('1e-65'))),
            ).toBeLessThanOrEqual(0);
          }
          for (const [id, value] of Object.entries(sample.currents)) {
            const error = e.q.abs(e.parse(value));
            expect(
              e.q.compare(
                error,
                e.q.add(e.fromFloat(bounds[`current:${id}`].bound), e.parse('1e-65')),
              ),
            ).toBeLessThanOrEqual(0);
          }
        }
        for (const t of [
          plan.summary.settlingTime,
          plan.summary.settlingTime * 1.1,
          plan.summary.settlingTime * 2,
        ]) {
          const f = frame(plan, t),
            end = frame(plan, 'equilibrium');
          const bounds = ok(plan.remaining(t));
          for (const [id, v] of Object.entries(f.voltages)) {
            const bound = bounds[`voltage:${id}`];
            expect(Math.abs(v.value - end.voltages[id].value)).toBeLessThanOrEqual(
              bound.bound + v.absoluteError,
            );
            expect(bound.bound).toBeLessThanOrEqual(bound.tolerance);
          }
        }
      },
      30_000,
    );
  it('encloses the exponential without trusting host Math.exp as an oracle', () => {
    const known = [
      ['1', '0.367879441171442321595523770161460867445811131031767834507836801697'],
      ['10', '0.000045399929762484851535591515560550610237918088866564969259071305650999'],
    ];
    for (const [t, truth] of known) {
      const interval = decay(1, Number(t));
      const e = exactArithmetic(defaultLimits);
      expect(e.q.compare(e.fromFloat(interval[0]), e.parse(truth))).toBeLessThanOrEqual(0);
      expect(e.q.compare(e.fromFloat(interval[1]), e.parse(truth))).toBeGreaterThanOrEqual(0);
    }
    expect(decay(1, 1000)).toEqual([0, Number.MIN_VALUE]);
  });
  it('does not settle at an initial modal cancellation', () => {
    const reference = references.cases.find((c) => c.name === 'cancellation-at-initial-crossing')!;
    const plan = ok(prepareRc(reference.circuit as unknown as RcCircuit));
    expect(frame(plan, 0).nodeVoltages.n0.exact).toBe('10/1');
    expect(frame(plan, 1).nodeVoltages.n0.value).toBeLessThan(9);
    expect(plan.summary.settlingTime).toBeGreaterThan(1);
    expect(ok(plan.remaining(0))['voltage:C0'].bound).toBeGreaterThan(1);
  });
});
