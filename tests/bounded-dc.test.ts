import { describe, expect, it } from 'vitest';
import type { CompiledCircuit, Rational } from '../src/domain';
import { createBudget } from '../src/simulation/budget';
import { approximateSolve } from '../src/simulation/approximate';
import { solveCircuit, checkKcl, equivalentResistance } from '../src/simulation';
import * as q from '../src/rational';
import { formatQuantity } from '../src/quantity';
import { examples } from '../src/fixtures';
import { compileCircuit } from '../src/connectivity';
import { buildCurrentModel, buildPotentialModel, potentialAxisValue } from '../src/visualization';
import {
  createMeasurementRecord,
  measurementsToCsv,
  probeVoltage,
  probeCurrent,
} from '../src/measurement';
import { saveMeasurementNotebook, loadMeasurementNotebook } from '../src/persistence';

function grid(side: number, long = false): CompiledCircuit {
  const nets = Array.from({ length: side * side }, (_, i) => ({
    id: `n${String(i).padStart(3, '0')}`,
    endpointIds: [],
    wireIds: [],
  }));
  const elements: CompiledCircuit['elements'] = [];
  const primes = [101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 151, 157];
  const edge = (a: number, b: number) => {
    const i = elements.length;
    elements.push({
      id: `R${String(i).padStart(3, '0')}`,
      type: 'resistor',
      a: nets[a].id,
      b: nets[b].id,
      closed: true,
      value: long
        ? q.add(primes[i % primes.length], q.rational(BigInt(i + 1), 10n ** 80n + 7n))
        : q.from(primes[i % primes.length]),
    });
  };
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      const i = y * side + x;
      if (x + 1 < side) edge(i, i + 1);
      if (y + 1 < side) edge(i, i + side);
    }
  elements.push({
    id: 'V1',
    type: 'dc-voltage-source',
    a: nets[0].id,
    b: nets.at(-1)!.id,
    value: q.from(12),
    closed: true,
  });
  return { nets, elements, endpointToNet: {}, referenceNetId: nets.at(-1)!.id };
}

describe('bounded exact DC and explicit approximate values', () => {
  it('counts GCD remainders and checks unreduced integer boundaries before work', () => {
    const budget = createBudget({ bits: 4, remainders: 2 });
    budget.integer(15n);
    budget.integer(-15n);
    budget.integer(0n);
    expect(() => budget.integer(16n)).toThrow('integer-limit');
    expect(() => budget.integer(-16n)).toThrow('integer-limit');
    budget.remainder();
    budget.remainder();
    expect(() => budget.remainder()).toThrow('operation-limit');
    const math = q.createArithmetic(createBudget({ bits: 10, remainders: 1 }));
    expect(math.rational(1n)).toEqual(q.ONE);
    expect(() => math.rational(1n)).toThrow('operation-limit');
    expect(() =>
      q.createArithmetic(createBudget({ bits: 4, remainders: 100 })).rational(16n, 16n),
    ).toThrow('integer-limit');
    expect(() => q.createArithmetic(createBudget()).rational(1n << 4096n)).toThrow('integer-limit');
    expect(q.createArithmetic(createBudget()).rational((1n << 4096n) - 1n).numerator).toBe(
      (1n << 4096n) - 1n,
    );
  });
  it('keeps ordinary circuits exact, stops expensive arithmetic and restarts deterministically', () => {
    const exact = solveCircuit(grid(5));
    expect(exact.quality).toEqual({ mode: 'exact' });
    const input = grid(5, true),
      original = structuredClone(input);
    const approx = solveCircuit(input);
    expect(approx.status).toBe('solved');
    expect(approx.quality).toMatchObject({ mode: 'approximate', reason: 'integer-limit' });
    expect(
      solveCircuit({
        ...input,
        elements: [...input.elements].reverse(),
        nets: [...input.nets].reverse(),
      }),
    ).toEqual(approx);
    expect(input).toEqual(original);
    for (const id in exact.nodeVoltages) {
      const v = approx.nodeVoltages[id];
      expect(Math.abs(q.toNumber(q.sub(v, exact.nodeVoltages[id])))).toBeLessThanOrEqual(
        v.approximation!.absoluteError + 1e-14,
      );
    }
    for (const net of input.nets)
      expect(checkKcl(input, approx, net.id)).toMatchObject({ passes: true, approximate: true });
    expect(q.direction(q.sum(Object.values(approx.componentPowers)))).toBeUndefined();
    const resistance = equivalentResistance(input, input.nets[0].id, input.nets.at(-1)!.id, {
      excludeSourceIds: ['V1'],
    });
    expect(resistance.status).toBe('finite');
    expect(resistance.ohms?.approximation).toBeDefined();
    expect(formatQuantity(resistance.ohms, 'Ω')).toMatch(/^≈ /);
    expect(solveCircuit(grid(7)).quality).toMatchObject({
      mode: 'approximate',
      reason: 'operation-limit',
    });
  });
  it('rejects unreliable or out-of-range approximations and unverified source constraints', () => {
    const value = (v: number) => q.from(v);
    const model = {
      size: 2,
      terms: [
        { row: 0, col: 0, value: value(1) },
        { row: 0, col: 1, value: value(1) },
        { row: 1, col: 0, value: value(1) },
        { row: 1, col: 1, value: value(1 + 1e-14) },
      ],
      rhs: [value(2), value(2)],
    };
    expect(() => approximateSolve(model, 'integer-limit')).toThrow('numerical-instability');
    expect(() =>
      approximateSolve(
        { size: 1, terms: [{ row: 0, col: 0, value: q.ONE }], rhs: [q.power10(400)] },
        'integer-limit',
      ),
    ).toThrow('range');
    const circuit = grid(2);
    circuit.elements.at(-1)!.value = q.power10(1300);
    expect(solveCircuit(circuit)).toMatchObject({
      status: 'error',
      diagnostics: [{ code: 'APPROXIMATE_SOLVE_FAILED', parameters: { reason: 'unverified' } }],
    });
    const short = grid(5, true);
    short.elements.push({ ...short.elements.at(-1)!, id: 'short', type: 'ammeter', value: q.ZERO });
    expect(solveCircuit(short).diagnostics[0].code).toBe('SOURCE_SHORT');
  });
  it('scales extreme coefficients before binary64 conversion and preserves known solutions', () => {
    const model = {
      size: 2,
      terms: [
        { row: 0, col: 0, value: q.power10(400) },
        { row: 1, col: 1, value: q.power10(-400) },
      ],
      rhs: [q.mul(3, q.power10(400)), q.mul(-2, q.power10(-400))],
    };
    const result = approximateSolve(model, 'integer-limit');
    expect(result.x.map(q.toNumber)).toEqual([3, -2]);
    expect(result.x.every((v) => Number.isFinite(v.approximation!.absoluteError))).toBe(true);
    const a = {
      ...q.from(2),
      approximation: {
        reason: 'integer-limit' as const,
        policy: 'dc-budget-1' as const,
        absoluteError: 0.1,
      },
    };
    const reciprocal = q.div(1, a);
    expect(reciprocal.approximation!.absoluteError).toBeGreaterThanOrEqual(
      Math.abs(1 / 1.9 - 0.5) - 1e-16,
    );
    expect(q.mul(a, a).approximation!.absoluteError).toBeGreaterThanOrEqual(0.41 - 1e-15);
    expect(q.direction(q.sub(a, 2))).toBeUndefined();
    expect(q.direction(q.power10(-400))).toBe(1);
  });
  it('propagates uncertainty through probes, flow, axes and notebook v4 round trips', () => {
    const doc = structuredClone(examples.find((e) => e.id === 'FIX-09')!.document),
      compiled = compileCircuit(doc);
    const result = solveCircuit(compiled.circuit);
    const approximate = (v: Rational, error = 1e-12): Rational => ({
      ...v,
      approximation: { reason: 'integer-limit', policy: 'dc-budget-1', absoluteError: error },
    });
    for (const map of [
      result.nodeVoltages,
      result.branchCurrents,
      result.componentVoltages,
      result.componentPowers,
    ])
      for (const key in map) map[key] = approximate(map[key]);
    result.quality = {
      mode: 'approximate',
      reason: 'integer-limit',
      policy: 'dc-budget-1',
      condition: 10,
      backwardError: 0,
      refinements: 0,
    };
    const red = { kind: 'terminal' as const, id: 'R5.a' },
      black = { kind: 'terminal' as const, id: 'R5.b' };
    const reading = probeVoltage(compiled, result, red, black);
    expect(reading.ok).toBe(true);
    if (!reading.ok) return;
    expect(reading.value.voltageV.approximation?.absoluteError).toBe(2e-12);
    const current = probeCurrent(doc, compiled, result, { kind: 'component', id: 'R5' });
    expect(current.ok && q.direction(current.value.amperes)).toBeUndefined();
    expect(
      buildCurrentModel(doc, compiled, result).samples.find((s) => s.id === 'R5')?.value.status,
    ).toBe('uncertain');
    const potential = buildPotentialModel(doc, compiled.circuit, result);
    expect(formatQuantity(potentialAxisValue(potential, potential.max), 'V')).toMatch(/^≈ /);
    const record = createMeasurementRecord(doc, {
      condition: '시험',
      source: 'simulation',
      quantity: 'voltage',
      value: reading.value.voltageV,
      unit: 'V',
      targetIds: [red.id, black.id],
    });
    expect(record.ok).toBe(true);
    if (!record.ok) return;
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    };
    const entry = {
      id: 'one',
      record: record.value,
      note: '',
      sourcesDisconnected: false,
      anchors: {
        red: { kind: 'endpoint' as const, id: red.id, endpointKind: red.kind },
        black: { kind: 'endpoint' as const, id: black.id, endpointKind: black.kind },
        current: null,
      },
    };
    expect(saveMeasurementNotebook([entry], storage)).toBe(true);
    expect(loadMeasurementNotebook(storage).entries).toEqual([entry]);
    expect(measurementsToCsv([record.value])).toMatchObject({
      ok: true,
      value: expect.stringContaining('≈ '),
    });
    const stored = JSON.parse(data.get('edu-circuit:measurement-notebook:v4')!);
    delete stored.entries[0].record.value.approximation;
    data.set('edu-circuit:measurement-notebook:v4', JSON.stringify(stored));
    expect(loadMeasurementNotebook(storage).entries).toEqual([]);
    expect(formatQuantity(q.from(12), 'V')).toBe('12 V');
  });
});
