import { readFileSync, readdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {
  emptyDocument,
  requireDocument,
  type CompiledCircuit,
  type SimulationResult,
} from '../src/domain';
import { compileCircuit } from '../src/connectivity';
import { solveCircuit, checkKcl } from '../src/simulation';
import { buildCurrentModel, buildPotentialModel } from '../src/visualization';
import { analyze } from '../src/app/analyze';
import { adjustableParameter, parameterValueAt } from '../src/component-library';
import * as q from '../src/rational';

type Case = {
  name: string;
  nets: number;
  elements: number;
  run: () => SimulationResult;
  circuit?: CompiledCircuit;
};
const fixtures = readdirSync('fixtures')
  .filter((n) => /^FIX-.*\.json$/.test(n))
  .sort();

function grid(side: number, values: 'varied' | 'wide' | 'long' = 'varied'): CompiledCircuit {
  const nets = Array.from({ length: side * side }, (_, i) => ({
    id: `n${String(i).padStart(3, '0')}`,
    endpointIds: [],
    wireIds: [],
  }));
  const elements: CompiledCircuit['elements'] = [];
  const primes = [101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 151, 157];
  function resistor(a: number, b: number) {
    const i = elements.length;
    let value = q.from(primes[i % primes.length]);
    if (values === 'wide') value = q.mul(value, q.power10(i % 2 ? 40 : -40));
    if (values === 'long') value = q.add(value, q.rational(BigInt(i + 1), 10n ** 80n + 7n));
    elements.push({
      id: `R${String(i).padStart(3, '0')}`,
      type: 'resistor',
      a: nets[a].id,
      b: nets[b].id,
      value,
      closed: true,
    });
  }
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      const i = y * side + x;
      if (x + 1 < side) resistor(i, i + 1);
      if (y + 1 < side) resistor(i, i + side);
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

function cases(): Case[] {
  const result: Case[] = [];
  for (const file of fixtures) {
    const doc = requireDocument(JSON.parse(readFileSync(`fixtures/${file}`, 'utf8')).document);
    const circuit = compileCircuit(doc).circuit;
    result.push({
      name: `${file.slice(0, 6)} solve`,
      nets: circuit.nets.length,
      elements: circuit.elements.length,
      circuit,
      run: () => solveCircuit(circuit),
    });
    if (solveCircuit(circuit).status === 'error') continue;
    result.push({
      name: `${file.slice(0, 6)} pipeline`,
      nets: circuit.nets.length,
      elements: circuit.elements.length,
      run: () => {
        const { compilation, result } = analyze(doc);
        buildCurrentModel(doc, compilation, result);
        buildPotentialModel(doc, compilation.circuit, result);
        return result;
      },
    });
    const variable = doc.components.find((c) => c.type === 'resistive-load');
    if (variable) {
      const parameter = adjustableParameter(variable)!;
      let step = 0;
      result.push({
        name: `${file.slice(0, 6)} sweep pipeline`,
        nets: circuit.nets.length,
        elements: circuit.elements.length,
        run: () => {
          variable.properties[parameter.property] = parameterValueAt(parameter, step++ % 1001);
          const { compilation, result } = analyze(doc);
          buildCurrentModel(doc, compilation, result);
          buildPotentialModel(doc, compilation.circuit, result);
          return result;
        },
      });
    }
  }
  for (const [side, values] of [
    [3, 'varied'],
    [5, 'varied'],
    [7, 'varied'],
    [3, 'wide'],
    [5, 'wide'],
    [3, 'long'],
    [5, 'long'],
  ] as const) {
    const circuit = grid(side, values);
    result.push({
      name: `grid ${side}x${side} ${values}`,
      nets: circuit.nets.length,
      elements: circuit.elements.length,
      circuit,
      run: () => solveCircuit(circuit),
    });
    if (side === 7 || (side === 5 && values !== 'varied')) {
      const doc = emptyDocument(`grid-${side}-${values}`);
      doc.junctions = circuit.nets.map((net, i) => ({
        id: net.id,
        position: { x: (i % side) * 200, y: Math.floor(i / side) * 200 },
      }));
      doc.referenceNode = { kind: 'junction', id: circuit.referenceNetId! };
      doc.components = circuit.elements.map((e, i) => ({
        id: e.id,
        type: e.type,
        label: e.id,
        position: { x: i * 20, y: 100 },
        rotation: 0,
        properties:
          e.type === 'dc-voltage-source'
            ? { voltageV: q.store(e.value) }
            : { resistanceOhm: q.store(e.value) },
        terminals: [
          { id: `${e.id}.a`, role: e.type === 'dc-voltage-source' ? 'positive' : 'a' },
          { id: `${e.id}.b`, role: e.type === 'dc-voltage-source' ? 'negative' : 'b' },
        ],
      }));
      doc.wires = circuit.elements.flatMap((e) => [
        {
          id: `${e.id}.wa`,
          start: { kind: 'terminal' as const, id: `${e.id}.a` },
          end: { kind: 'junction' as const, id: e.a },
          waypoints: [],
        },
        {
          id: `${e.id}.wb`,
          start: { kind: 'terminal' as const, id: `${e.id}.b` },
          end: { kind: 'junction' as const, id: e.b },
          waypoints: [],
        },
      ]);
      result.push({
        name: `grid ${side}x${side} ${values} pipeline`,
        nets: circuit.nets.length,
        elements: circuit.elements.length,
        run: () => {
          const { compilation, result } = analyze(doc);
          buildCurrentModel(doc, compilation, result);
          buildPotentialModel(doc, compilation.circuit, result);
          return result;
        },
      });
    }
  }
  return result;
}

function verify(c: Case, result: SimulationResult) {
  if (result.status === 'error') {
    assert(
      !c.name.startsWith('grid') ||
        (c.name.includes('wide') &&
          result.diagnostics.some((d) => d.code === 'APPROXIMATE_SOLVE_FAILED')),
      JSON.stringify(result.diagnostics),
    );
    return;
  }
  assert(
    result.quality?.mode === 'approximate'
      ? q.direction(q.sum(Object.values(result.componentPowers))) === undefined
      : q.equal(q.sum(Object.values(result.componentPowers)), q.ZERO),
    `${c.name}: power`,
  );
  if (c.circuit)
    for (const net of c.circuit.nets)
      assert(checkKcl(c.circuit, result, net.id).passes, `${c.name}: KCL`);
}

export async function run(profile: boolean, filter = '', once = false) {
  const output = [];
  const globals = globalThis as typeof globalThis & {
    gc?: () => void;
    __dcObserve?: (n: bigint, d: bigint) => void;
  };
  for (const c of cases().filter((c) => c.name.includes(filter))) {
    if (profile) {
      let maxBits = 0,
        constructions = 0;
      globals.__dcObserve = (n, d) => {
        constructions++;
        maxBits = Math.max(maxBits, (n < 0n ? -n : n).toString(2).length, d.toString(2).length);
      };
      const result = c.run();
      globals.__dcObserve = () => {};
      verify(c, result);
      output.push({ name: c.name, maxFractionInputBits: maxBits, constructions });
      continue;
    }
    for (let i = 0; i < (once ? 0 : 3); i++) verify(c, c.run());
    globals.gc?.();
    const heapBefore = process.memoryUsage().heapUsed;
    let heapSampleMax = heapBefore;
    const samples: number[] = [];
    const start = performance.now();
    let last: SimulationResult;
    do {
      const t = performance.now();
      last = c.run();
      samples.push(performance.now() - t);
      heapSampleMax = Math.max(heapSampleMax, process.memoryUsage().heapUsed);
    } while (
      !once &&
      samples.length < 100 &&
      (samples.length < 8 || performance.now() - start < 1500)
    );
    verify(c, last!);
    globals.gc?.();
    samples.sort((a, b) => a - b);
    const row = {
      name: c.name,
      nets: c.nets,
      elements: c.elements,
      runs: samples.length,
      status: last!.status,
      quality: last!.quality,
      diagnostics: last!.diagnostics.map((d) => ({ code: d.code, parameters: d.parameters })),
      medianMs: samples[Math.floor(samples.length / 2)],
      p95Ms: samples[Math.ceil(samples.length * 0.95) - 1],
      maxMs: samples.at(-1),
      heapSampleGrowthMiB: (heapSampleMax - heapBefore) / 2 ** 20,
      retainedHeapDeltaMiB: (process.memoryUsage().heapUsed - heapBefore) / 2 ** 20,
    };
    output.push(row);
    console.log(JSON.stringify(row));
  }
  return output;
}

/** Whole slider ranges and repeated full cycles; no React or paint costs included. */
export function soak() {
  const output = [];
  for (const file of fixtures.filter((name) => /FIX-(09|11|12)-/.test(name))) {
    const doc = requireDocument(JSON.parse(readFileSync(`fixtures/${file}`, 'utf8')).document);
    const variable = doc.components.find((c) => c.type === 'resistive-load')!;
    const parameter = adjustableParameter(variable)!;
    const heaps: number[] = [],
      cycleMs: number[] = [];
    for (let cycle = 0; cycle < 10; cycle++) {
      const start = performance.now();
      for (let step = 0; step <= 1000; step++) {
        variable.properties[parameter.property] = parameterValueAt(parameter, step);
        const { compilation, result } = analyze(doc);
        assert.equal(result.status, 'solved');
        buildCurrentModel(doc, compilation, result);
        buildPotentialModel(doc, compilation.circuit, result);
        // Every distinct step receives exact physical verification on the first cycle.
        if (cycle === 0)
          verify(
            { name: file, nets: 0, elements: 0, circuit: compilation.circuit, run: () => result },
            result,
          );
      }
      cycleMs.push(performance.now() - start);
      globalThis.gc?.();
      heaps.push(process.memoryUsage().heapUsed / 2 ** 20);
    }
    const row = {
      name: file,
      stepsPerCycle: 1001,
      cycles: 10,
      verifiedSteps: 1001,
      cycleMs,
      heapAfterGcMiB: heaps,
      heapDeltaAfterFirstCycleMiB: heaps.at(-1)! - heaps[0],
    };
    console.log(JSON.stringify(row));
    output.push(row);
  }
  return output;
}
