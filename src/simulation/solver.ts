import * as arithmetic from '../rational';
import { createBudget, BudgetExceeded } from './budget';
import { approximateSolve, ApproximateFailure } from './approximate';
import { mna, resistive, idealLink } from './mna';
import { solvePiecewise, profileRevision } from './piecewise';
const q = arithmetic;
import type { Rational } from '../domain';
import {
  diagnostic,
  type CompiledCircuit,
  type CompiledElement,
  type Diagnostic,
  type SimulationEngine,
  type SimulationResult,
  type SolveOptions,
} from '../domain';

export function failedResult(diagnostics: Diagnostic[]): SimulationResult {
  return {
    status: 'error',
    nodeVoltages: {},
    branchCurrents: {},
    componentVoltages: {},
    componentPowers: {},
    diagnostics,
  };
}
const conducts = (e: CompiledElement) =>
  resistive(e) || idealLink(e) || e.type === 'dc-voltage-source';
const voltageConstraint = (e: CompiledElement) => idealLink(e) || e.type === 'dc-voltage-source';

function reachable(start: string, edges: CompiledElement[]): Set<string> {
  const graph = new Map<string, string[]>();
  for (const e of edges) {
    graph.set(e.a, [...(graph.get(e.a) ?? []), e.b]);
    graph.set(e.b, [...(graph.get(e.b) ?? []), e.a]);
  }
  const seen = new Set([start]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++)
    for (const next of graph.get(queue[i]) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  return seen;
}

/** Deterministic exact elimination; matrix storage stays inside the engine. */
function solveLinear(
  matrix: Rational[][],
  rhs: Rational[],
  q: ReturnType<typeof arithmetic.createArithmetic>,
): Rational[] | null {
  const size = rhs.length,
    a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let k = 0; k < size; k++) {
    const pivot = a.findIndex((row, i) => i >= k && q.sign(row[k]) !== 0);
    if (pivot < 0) return null;
    [a[k], a[pivot]] = [a[pivot], a[k]];
    for (let i = k + 1; i < size; i++) {
      if (!q.sign(a[i][k])) continue;
      const ratio = q.div(a[i][k], a[k][k]);
      a[i][k] = q.ZERO;
      for (let j = k + 1; j <= size; j++) a[i][j] = q.sub(a[i][j], q.mul(ratio, a[k][j]));
    }
  }
  const x = Array<Rational>(size).fill(q.ZERO);
  for (let i = size - 1; i >= 0; i--) {
    let value = a[i][size];
    for (let j = i + 1; j < size; j++) value = q.sub(value, q.mul(a[i][j], x[j]));
    x[i] = q.div(value, a[i][i]);
  }
  return x;
}

function solveLinearCircuit(
  circuit: CompiledCircuit,
  options: SolveOptions = {},
): SimulationResult {
  const q = arithmetic.createArithmetic(createBudget());
  let validated = false;
  let original: ReturnType<typeof mna> | undefined;
  let finish:
    | ((x: Rational[], quality: NonNullable<SimulationResult['quality']>) => SimulationResult)
    | undefined;
  try {
    if (Object.keys(options).length) return failedResult([diagnostic('INVALID_SOLVE_OPTIONS')]);
    const compare = (a: { id: string }, b: { id: string }) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    const nets = [...circuit.nets].sort(compare);
    const elements = [...circuit.elements].sort(compare);
    const netIds = new Set(nets.map((n) => n.id));
    const invalid = elements.filter(
      (e) =>
        !q.isRational(e.value) ||
        e.value.approximation !== undefined ||
        (resistive(e) && q.sign(e.value) < 0) ||
        !netIds.has(e.a) ||
        !netIds.has(e.b),
    );
    if (invalid.length)
      return failedResult([
        diagnostic(
          'INVALID_COMPONENT_VALUE',
          invalid.map((e) => e.id),
        ),
      ]);
    if (!nets.length)
      return { ...failedResult([diagnostic('EMPTY_CIRCUIT', [], 'info')]), status: 'warning' };

    const zero = elements.filter(idealLink);
    const shorts = elements.filter(
      (e) =>
        e.type === 'dc-voltage-source' && q.sign(e.value) !== 0 && reachable(e.a, zero).has(e.b),
    );
    if (shorts.length) {
      const diagnostics = shorts.map((e) =>
        diagnostic('SOURCE_SHORT', [
          e.id,
          ...zero.filter((z) => reachable(e.a, zero).has(z.a)).map((z) => z.id),
        ]),
      );
      for (const source of shorts) {
        const meters = zero.filter(
          (e) => e.type === 'ammeter' && reachable(source.a, zero).has(e.a),
        );
        if (meters.length)
          diagnostics.push(
            diagnostic('AMMETER_PARALLEL_TO_SOURCE', [source.id, ...meters.map((e) => e.id)]),
          );
      }
      return failedResult(diagnostics);
    }

    const constraints = elements.filter(voltageConstraint);
    const relative = new Map<string, Rational>();
    const graph = new Map<string, { other: string; delta: Rational; id: string }[]>();
    for (const e of constraints) {
      const v = e.type === 'dc-voltage-source' ? e.value : q.ZERO;
      graph.set(e.a, [...(graph.get(e.a) ?? []), { other: e.b, delta: q.neg(v), id: e.id }]);
      graph.set(e.b, [...(graph.get(e.b) ?? []), { other: e.a, delta: v, id: e.id }]);
    }
    // Detect inconsistent ideal constraints before eliminating the MNA matrix.
    for (const net of nets) {
      if (relative.has(net.id)) continue;
      relative.set(net.id, q.ZERO);
      const queue = [net.id];
      for (let i = 0; i < queue.length; i++)
        for (const edge of graph.get(queue[i]) ?? []) {
          const expected = q.add(relative.get(queue[i])!, edge.delta);
          if (relative.has(edge.other)) {
            const actual = relative.get(edge.other)!;
            if (!q.equal(actual, expected)) {
              return failedResult([
                diagnostic(
                  'CONFLICTING_SOURCES',
                  constraints.map((e) => e.id),
                ),
              ]);
            }
          } else {
            relative.set(edge.other, expected);
            queue.push(edge.other);
          }
        }
    }
    const reference = circuit.referenceNetId;
    if (!reference || !netIds.has(reference))
      return failedResult([
        diagnostic(
          'FLOATING_SUBCIRCUIT',
          nets.flatMap((n) => n.endpointIds),
        ),
      ]);
    const connected = reachable(reference, elements.filter(conducts));
    const floating = nets.filter((n) => !connected.has(n.id));
    if (floating.length)
      return failedResult([
        diagnostic(
          'FLOATING_SUBCIRCUIT',
          floating.flatMap((n) => n.endpointIds),
        ),
      ]);

    const voltageNets = nets.filter((n) => n.id !== reference);
    const count = voltageNets.length;
    validated = true;
    original = mna(
      elements,
      constraints,
      voltageNets.map((n) => n.id),
    );
    const { size } = original;
    finish = (x, quality) => {
      const approximate = quality.mode === 'approximate';
      const math = approximate ? arithmetic : q;
      const zero: Rational = approximate
        ? {
            ...q.ZERO,
            approximation: { reason: quality.reason, policy: quality.policy, absoluteError: 0 },
          }
        : q.ZERO;
      const result: SimulationResult = {
        status: 'solved',
        quality,
        nodeVoltages: { [reference]: zero },
        branchCurrents: Object.create(null),
        componentVoltages: Object.create(null),
        componentPowers: Object.create(null),
        diagnostics: approximate
          ? [
              diagnostic(
                'APPROXIMATE_SOLUTION',
                elements.map((e) => e.id),
                'info',
                { reason: quality.reason, policy: quality.policy },
              ),
            ]
          : [],
      };
      voltageNets.forEach((n, i) => {
        result.nodeVoltages[n.id] = x[i];
      });
      const constraintIndices = new Map(constraints.map((e, k) => [e.id, count + k]));
      for (const e of elements) {
        const v = math.sub(result.nodeVoltages[e.a], result.nodeVoltages[e.b]),
          k = constraintIndices.get(e.id);
        const current = k !== undefined ? x[k] : resistive(e) ? math.div(v, e.value) : zero;
        result.componentVoltages[e.id] = v;
        result.branchCurrents[e.id] = current;
        result.componentPowers[e.id] = math.mul(v, current);
        if (
          approximate &&
          [v, current, result.componentPowers[e.id]].some(
            (value) =>
              !Number.isFinite(math.toNumber(value)) ||
              (math.sign(value) !== 0 && math.toNumber(value) === 0) ||
              value.approximation?.absoluteError === Number.MAX_VALUE,
          )
        )
          throw new ApproximateFailure('range');
      }
      return result;
    };
    const matrix = Array.from({ length: size }, () => Array<Rational>(size).fill(q.ZERO));
    const rhs = original.rhs;
    for (const { row, col, value } of original.terms)
      matrix[row][col] = q.add(matrix[row][col], value);
    const x = solveLinear(matrix, rhs, q);
    if (!x)
      return failedResult([
        diagnostic(
          'SINGULAR_SYSTEM',
          constraints.map((e) => e.id),
        ),
      ]);
    const residualValid = matrix.every((row, i) =>
      q.equal(q.sum(row.map((v, j) => q.mul(v, x[j]))), rhs[i]),
    );
    if (!residualValid)
      return failedResult([
        diagnostic(
          'EXACT_SOLVE_FAILED',
          elements.map((e) => e.id),
        ),
      ]);
    return finish(x, { mode: 'exact' });
  } catch (error) {
    if (!(error instanceof BudgetExceeded)) throw error;
    if (!validated || !original || !finish)
      return failedResult([
        diagnostic(
          'APPROXIMATE_SOLVE_FAILED',
          circuit.elements.map((e) => e.id),
          'error',
          { reason: 'unverified', trigger: error.reason },
        ),
      ]);
    try {
      const solved = approximateSolve(original, error.reason);
      return finish(solved.x, solved.quality);
    } catch (failure) {
      if (!(failure instanceof ApproximateFailure)) throw failure;
      return failedResult([
        diagnostic(
          'APPROXIMATE_SOLVE_FAILED',
          circuit.elements.map((e) => e.id),
          'error',
          { reason: failure.reason, trigger: error.reason },
        ),
      ]);
    }
  }
}
export function solveCircuit(
  circuit: CompiledCircuit,
  options: SolveOptions = {},
): SimulationResult {
  if (
    Object.keys(options).some((key) => key !== 'physicalModel') ||
    (options.physicalModel !== undefined &&
      options.physicalModel !== 'textbook' &&
      options.physicalModel !== 'component')
  )
    return failedResult([diagnostic('INVALID_SOLVE_OPTIONS')]);
  if (options.physicalModel === 'component' || circuit.elements.some((e) => e.type === 'diode'))
    return solvePiecewise(circuit, options);
  const result = solveLinearCircuit(circuit);
  if (
    result.diagnostics.some((d) => d.code === 'SINGULAR_SYSTEM' || d.code === 'FLOATING_SUBCIRCUIT')
  )
    return solvePiecewise(circuit, options);
  if (result.quality)
    result.provenance = {
      physicalModel: 'textbook',
      profileRevision: profileRevision(circuit),
      arithmeticQuality: result.quality.mode,
    };
  return result;
}
export const dcEngine: SimulationEngine = { solve: solveCircuit };
