export type { SimulationEngine, SimulationResult, SolveOptions } from '../domain';
import { diagnostic, type CompiledCircuit, type CompiledElement, type Diagnostic, type SimulationEngine, type SimulationResult, type SolveOptions } from '../domain';

export function failedResult(diagnostics: Diagnostic[]): SimulationResult {
  return { status: 'error', nodeVoltages: {}, branchCurrents: {}, componentVoltages: {}, componentPowers: {}, diagnostics };
}
const resistive = (e: CompiledElement) => e.type === 'resistor' || e.type === 'resistive-load';
const idealLink = (e: CompiledElement) => e.type === 'ammeter' || (e.type === 'switch' && e.closed) || (resistive(e) && e.value === 0);
const conducts = (e: CompiledElement) => resistive(e) || idealLink(e) || e.type === 'dc-voltage-source';
const voltageConstraint = (e: CompiledElement) => idealLink(e) || e.type === 'dc-voltage-source';

function reachable(start: string, edges: CompiledElement[]): Set<string> {
  const graph = new Map<string, string[]>();
  for (const e of edges) {
    graph.set(e.a, [...(graph.get(e.a) ?? []), e.b]);
    graph.set(e.b, [...(graph.get(e.b) ?? []), e.a]);
  }
  const seen = new Set([start]); const queue = [start];
  for (let i = 0; i < queue.length; i++) for (const next of graph.get(queue[i]) ?? []) {
    if (!seen.has(next)) { seen.add(next); queue.push(next); }
  }
  return seen;
}

/** Row scaling and partial pivoting. Matrix storage stays inside the engine. */
function solveLinear(matrix: number[][], rhs: number[]): number[] | null {
  const size = rhs.length;
  const a = matrix.map((row, i) => {
    const scale = Math.max(...row.map(Math.abs), 0) || 1;
    return [...row.map(v => v / scale), rhs[i] / scale];
  });
  for (let k = 0; k < size; k++) {
    let pivot = k;
    for (let i = k + 1; i < size; i++) if (Math.abs(a[i][k]) > Math.abs(a[pivot][k])) pivot = i;
    if (Math.abs(a[pivot][k]) < 1e-13) return null;
    [a[k], a[pivot]] = [a[pivot], a[k]];
    for (let i = k + 1; i < size; i++) {
      const ratio = a[i][k] / a[k][k]; a[i][k] = 0;
      for (let j = k + 1; j <= size; j++) a[i][j] -= ratio * a[k][j];
    }
  }
  const x = Array<number>(size).fill(0);
  for (let i = size - 1; i >= 0; i--) {
    let value = a[i][size];
    for (let j = i + 1; j < size; j++) value -= a[i][j] * x[j];
    x[i] = value / a[i][i];
  }
  return x.every(Number.isFinite) ? x : null;
}

export function solveCircuit(circuit: CompiledCircuit, options: SolveOptions = {}): SimulationResult {
  const abs = options.absoluteTolerance ?? 1e-9; const rel = options.relativeTolerance ?? 1e-9;
  if (![abs, rel].every(v => Number.isFinite(v) && v >= 0)) return failedResult([diagnostic('INVALID_SOLVE_OPTIONS')]);
  const compare = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  const nets = [...circuit.nets].sort(compare);
  const elements = [...circuit.elements].sort(compare);
  const netIds = new Set(nets.map(n => n.id));
  const invalid = elements.filter(e => !Number.isFinite(e.value) || (resistive(e) && e.value < 0) || !netIds.has(e.a) || !netIds.has(e.b));
  if (invalid.length) return failedResult([diagnostic('INVALID_COMPONENT_VALUE', invalid.map(e => e.id))]);
  if (!nets.length) return { ...failedResult([diagnostic('EMPTY_CIRCUIT', [], 'info')]), status: 'warning' };

  const zero = elements.filter(idealLink);
  const shorts = elements.filter(e => e.type === 'dc-voltage-source' && e.value !== 0 && reachable(e.a, zero).has(e.b));
  if (shorts.length) {
    const diagnostics = shorts.map(e => diagnostic('SOURCE_SHORT', [e.id, ...zero.filter(z => reachable(e.a, zero).has(z.a)).map(z => z.id)]));
    for (const source of shorts) {
      const meters = zero.filter(e => e.type === 'ammeter' && reachable(source.a, zero).has(e.a));
      if (meters.length) diagnostics.push(diagnostic('AMMETER_PARALLEL_TO_SOURCE', [source.id, ...meters.map(e => e.id)]));
    }
    return failedResult(diagnostics);
  }

  const constraints = elements.filter(voltageConstraint);
  const relative = new Map<string, number>();
  const graph = new Map<string, { other: string; delta: number; id: string }[]>();
  for (const e of constraints) {
    const v = e.type === 'dc-voltage-source' ? e.value : 0;
    graph.set(e.a, [...(graph.get(e.a) ?? []), { other: e.b, delta: -v, id: e.id }]);
    graph.set(e.b, [...(graph.get(e.b) ?? []), { other: e.a, delta: v, id: e.id }]);
  }
  // Detect inconsistent ideal constraints before eliminating the MNA matrix.
  for (const net of nets) {
    if (relative.has(net.id)) continue;
    relative.set(net.id, 0); const queue = [net.id];
    for (let i = 0; i < queue.length; i++) for (const edge of graph.get(queue[i]) ?? []) {
      const expected = relative.get(queue[i])! + edge.delta;
      if (relative.has(edge.other)) {
        const actual = relative.get(edge.other)!;
        if (Math.abs(actual - expected) > abs + rel * Math.max(Math.abs(actual), Math.abs(expected))) {
          return failedResult([diagnostic('CONFLICTING_SOURCES', constraints.map(e => e.id))]);
        }
      } else { relative.set(edge.other, expected); queue.push(edge.other); }
    }
  }
  const reference = circuit.referenceNetId;
  if (!reference || !netIds.has(reference)) return failedResult([diagnostic('FLOATING_SUBCIRCUIT', nets.flatMap(n => n.endpointIds))]);
  const connected = reachable(reference, elements.filter(conducts));
  const floating = nets.filter(n => !connected.has(n.id));
  if (floating.length) return failedResult([diagnostic('FLOATING_SUBCIRCUIT', floating.flatMap(n => n.endpointIds))]);

  const voltageNets = nets.filter(n => n.id !== reference);
  const index = new Map(voltageNets.map((n, i) => [n.id, i]));
  const count = voltageNets.length; const size = count + constraints.length;
  const matrix = Array.from({ length: size }, () => Array<number>(size).fill(0));
  const rhs = Array<number>(size).fill(0);
  const stamp = (a: string, b: string, value: number) => {
    const i = index.get(a), j = index.get(b);
    if (i !== undefined) matrix[i][i] += value;
    if (j !== undefined) matrix[j][j] += value;
    if (i !== undefined && j !== undefined) { matrix[i][j] -= value; matrix[j][i] -= value; }
  };
  for (const e of elements) if (resistive(e) && e.value > 0) stamp(e.a, e.b, 1 / e.value);
  constraints.forEach((e, k) => {
    const row = count + k; const a = index.get(e.a), b = index.get(e.b);
    if (a !== undefined) { matrix[a][row] += 1; matrix[row][a] += 1; }
    if (b !== undefined) { matrix[b][row] -= 1; matrix[row][b] -= 1; }
    rhs[row] = e.type === 'dc-voltage-source' ? e.value : 0;
  });
  const x = solveLinear(matrix, rhs);
  if (!x) return failedResult([diagnostic('SINGULAR_SYSTEM', constraints.map(e => e.id))]);
  const residualValid = matrix.every((row, i) => {
    const actual = row.reduce((sum, a, j) => sum + a * x[j], 0);
    const scale = row.reduce((sum, a, j) => sum + Math.abs(a * x[j]), Math.abs(rhs[i]));
    return Math.abs(actual - rhs[i]) <= abs + rel * scale;
  });
  if (!residualValid) return failedResult([diagnostic('ILL_CONDITIONED_SYSTEM', elements.map(e => e.id))]);
  const result: SimulationResult = { status: 'solved', nodeVoltages: { [reference]: 0 }, branchCurrents: Object.create(null), componentVoltages: Object.create(null), componentPowers: Object.create(null), diagnostics: [] };
  voltageNets.forEach((n, i) => { result.nodeVoltages[n.id] = x[i]; });
  const constraintIndices = new Map(constraints.map((e, k) => [e.id, count + k]));
  for (const e of elements) {
    const v = result.nodeVoltages[e.a] - result.nodeVoltages[e.b];
    const k = constraintIndices.get(e.id);
    const current = k !== undefined ? x[k] : resistive(e) ? v / e.value : 0;
    result.componentVoltages[e.id] = v;
    result.branchCurrents[e.id] = current;
    result.componentPowers[e.id] = v * current;
  }
  if (![...Object.values(result.nodeVoltages), ...Object.values(result.branchCurrents), ...Object.values(result.componentVoltages), ...Object.values(result.componentPowers)].every(Number.isFinite)) {
    return failedResult([diagnostic('ILL_CONDITIONED_SYSTEM', elements.map(e => e.id))]);
  }
  return result;
}
export const dcEngine: SimulationEngine = { solve: solveCircuit };

export { equivalentResistance, checkKcl, checkKvl, type ResistanceResult, type ConservationResult } from './measurements';
