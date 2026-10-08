import {
  diagnostic,
  type CompiledCircuit,
  type CompiledElement,
  type Rational,
  type SimulationResult,
  type SolveOptions,
} from '../domain';
import * as arithmetic from '../rational';
import { BudgetExceeded } from './budget';
import { mna, resistive, idealLink } from './mna';
import { EquilibriumVerificationError, selectEquilibrium } from './equilibrium';
import {
  affineSolve,
  combination,
  createSolveWork,
  feasible,
  querySpace,
  type QuantityQuery,
  type SolutionSpace,
  type Work,
} from './solution-space';

type Island = {
  nets: string[];
  elements: CompiledElement[];
  voltageIds: string[];
  constraints: CompiledElement[];
  spaces: SolutionSpace[];
  reference?: string;
  valid: boolean;
};
type Context = { islands: Island[]; work: Work };
// Map identity survives the result wrappers used by diagnostics and the app. No matrix is public.
const contexts = new WeakMap<object, Context>();
const ordered = <T extends { id: string }>(items: T[]) =>
  [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const empty = (): SimulationResult => ({
  status: 'error',
  nodeVoltages: Object.create(null),
  branchCurrents: Object.create(null),
  componentVoltages: Object.create(null),
  componentPowers: Object.create(null),
  diagnostics: [],
});
const connects = (e: CompiledElement) =>
  resistive(e) || idealLink(e) || e.type === 'dc-voltage-source' || e.type === 'diode';

export function profileRevision(circuit: CompiledCircuit, options: SolveOptions = {}): string {
  const profiles = ordered(circuit.elements)
    .filter((e) => e.operatingProfile)
    .map((e) => {
      const p = e.operatingProfile!;
      const values = [p.sourceResistanceOhm, p.diodeThresholdV, p.diodeOnResistanceOhm]
        .map((v) => (v ? `${v.numerator}/${v.denominator}` : '-'))
        .join(',');
      const boundaries = Object.entries(p.boundaries)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(
          ([key, b]) =>
            `${key}:${b!.continuousMax.numerator}/${b!.continuousMax.denominator}:${b!.damageAt.numerator}/${b!.damageAt.denominator}`,
        )
        .join(',');
      return `${e.id}:${p.id}@${p.revision}:${values}:${boundaries}`;
    })
    .join('|');
  const revision = circuit.elements.some((e) => e.type === 'diode')
    ? `diode-equilibrium-1|${profiles}`
    : profiles;
  return options.referencePolicy === 'independent' ? `${revision}|references:independent-1` : revision;
}

function split(circuit: CompiledCircuit, options: SolveOptions): Island[] {
  const remaining = new Set(ordered(circuit.nets).map((n) => n.id)),
    elements = ordered(circuit.elements),
    islands: Island[] = [];
  const neighbors = new Map<string, string[]>(),
    membership = new Map<string, Island>();
  for (const e of elements)
    if (connects(e)) {
      if (!neighbors.has(e.a)) neighbors.set(e.a, []);
      if (!neighbors.has(e.b)) neighbors.set(e.b, []);
      neighbors.get(e.a)!.push(e.b);
      neighbors.get(e.b)!.push(e.a);
    }
  while (remaining.size) {
    const ids = [remaining.values().next().value!];
    remaining.delete(ids[0]);
    for (let i = 0; i < ids.length; i++)
      for (const next of neighbors.get(ids[i]) ?? []) {
        if (remaining.delete(next)) ids.push(next);
      }
    ids.sort();
    const reference =
      circuit.referenceNetId && ids.includes(circuit.referenceNetId)
        ? circuit.referenceNetId
        : options.referencePolicy === 'independent'
          ? elements.find(e => e.type === 'dc-voltage-source' && ids.includes(e.b))?.b ?? ids[0]
          : undefined;
    const island: Island = {
      nets: ids,
      elements: [],
      voltageIds: ids.filter((id) => id !== reference),
      constraints: [],
      spaces: [],
      reference,
      valid: false,
    };
    islands.push(island);
    for (const id of ids) membership.set(id, island);
  }
  for (const e of elements) {
    const island = membership.get(e.a)!;
    if (island !== membership.get(e.b)) continue;
    island.elements.push(e);
    if (idealLink(e) || e.type === 'dc-voltage-source' || e.type === 'diode')
      island.constraints.push(e);
  }
  return islands;
}

/** Necessary and sufficient voltage feasibility for the supported passive ideal model. */
function voltageConflict(island: Island, work: Work): string[] | null {
  const { q } = work,
    distance = new Map(island.nets.map((id) => [id, q.ZERO]));
  const predecessor = new Map<string, { from: string; id: string }>();
  const edges = island.constraints.flatMap((e) => {
    const value =
      e.type === 'diode' ? q.rational(7n, 10n) : e.type === 'dc-voltage-source' ? e.value : q.ZERO;
    const forward = { from: e.b, to: e.a, value, id: e.id };
    return e.type === 'diode'
      ? [forward]
      : [forward, { from: e.a, to: e.b, value: q.neg(value), id: e.id }];
  });
  let last: string | undefined;
  for (let i = 0; i < island.nets.length; i++) {
    last = undefined;
    for (const edge of edges) {
      const candidate = q.add(distance.get(edge.from)!, edge.value);
      if (q.compare(candidate, distance.get(edge.to)!) < 0) {
        distance.set(edge.to, candidate);
        predecessor.set(edge.to, { from: edge.from, id: edge.id });
        last = edge.to;
      }
    }
    if (!last) return null;
  }
  for (let i = 0; i < island.nets.length; i++) last = predecessor.get(last!)!.from;
  const start = last,
    ids = new Set<string>();
  do {
    const edge = predecessor.get(last!)!;
    ids.add(edge.id);
    last = edge.from;
  } while (last !== start);
  return [...ids].sort();
}

function voltageWeights(island: Island, a: string, b?: string): Rational[] {
  const weights = Array<Rational>(island.voltageIds.length + island.constraints.length).fill(
    arithmetic.ZERO,
  );
  const i = island.voltageIds.indexOf(a),
    j = b === undefined ? -1 : island.voltageIds.indexOf(b);
  if (i >= 0) weights[i] = arithmetic.ONE;
  if (j >= 0) weights[j] = arithmetic.sub(weights[j], arithmetic.ONE);
  return weights;
}

function currentWeights(island: Island, e: CompiledElement, work: Work): Rational[] {
  const { q } = work,
    weights = voltageWeights(island, e.a, e.b),
    index = island.constraints.findIndex((c) => c.id === e.id);
  if (index >= 0) {
    weights.fill(q.ZERO);
    weights[island.voltageIds.length + index] = q.ONE;
  } else if (resistive(e)) weights.forEach((v, i) => (weights[i] = q.div(v, e.value)));
  else weights.fill(q.ZERO);
  return weights;
}

function queryIsland(island: Island, weights: Rational[], work: Work): QuantityQuery {
  if (!island.valid) return { status: 'unverified' };
  let minimum: Rational | undefined,
    maximum: Rational | undefined,
    unboundedMin = false,
    unboundedMax = false;
  for (const space of island.spaces) {
    const value = querySpace(space, weights, work);
    if (value.status === 'unverified') return value;
    const lower = value.status === 'unique' ? value.value : value.minimum,
      upper = value.status === 'unique' ? value.value : value.maximum;
    if (!lower) unboundedMin = true;
    else if (!minimum || work.q.compare(lower, minimum) < 0) minimum = lower;
    if (!upper) unboundedMax = true;
    else if (!maximum || work.q.compare(upper, maximum) > 0) maximum = upper;
  }
  if (!unboundedMin && !unboundedMax && minimum && maximum && work.q.equal(minimum, maximum))
    return { status: 'unique', value: minimum };
  return {
    status: 'nonunique',
    ...(!unboundedMin && minimum ? { minimum } : {}),
    ...(!unboundedMax && maximum ? { maximum } : {}),
  };
}

export function independentReferences(result: SimulationResult, a: string, b: string): boolean {
  const left = result.referenceGroups?.find(group => group.netIds.includes(a));
  const right = result.referenceGroups?.find(group => group.netIds.includes(b));
  return !!left && !!right && left.id !== right.id;
}

export function queryVoltage(result: SimulationResult, a: string, b: string): QuantityQuery {
  // Also guard copied/serialized results whose private affine context is no longer present.
  if (independentReferences(result, a, b)) return { status: 'nonunique' };
  const context = contexts.get(result.nodeVoltages);
  if (!context) {
    const va = result.nodeVoltages[a],
      vb = result.nodeVoltages[b];
    return arithmetic.isRational(va) && arithmetic.isRational(vb)
      ? { status: 'unique', value: a === b ? arithmetic.ZERO : arithmetic.sub(va, vb) }
      : { status: 'unverified' };
  }
  const island = context.islands.find((i) => i.nets.includes(a) && i.nets.includes(b));
  if (!island) return { status: 'nonunique' };
  // A measurement is a new bounded query: earlier probe positions must not consume its budget.
  try {
    return queryIsland(island, voltageWeights(island, a, b), createSolveWork());
  } catch (error) {
    if (!(error instanceof BudgetExceeded)) throw error;
    return { status: 'unverified' };
  }
}

export function queryCurrent(
  result: SimulationResult,
  terms: { componentId: string; coefficient: Rational | number }[],
): QuantityQuery {
  const context = contexts.get(result.nodeVoltages);
  if (!context) {
    let value = arithmetic.ZERO;
    for (const term of terms) {
      const current = result.branchCurrents[term.componentId];
      if (!current) return { status: 'unverified' };
      value = arithmetic.add(value, arithmetic.mul(term.coefficient, current));
    }
    return { status: 'unique', value };
  }
  try {
    const work = createSolveWork();
    let value = arithmetic.ZERO;
    const unresolved = terms.filter((term) => {
      const current = result.branchCurrents[term.componentId];
      if (!arithmetic.isRational(current)) return true;
      value = work.q.add(value, work.q.mul(term.coefficient, current));
      return false;
    });
    const remaining = new Set(unresolved.map((t) => t.componentId));
    for (const island of context.islands) {
      const weights = voltageWeights(island, '');
      let used = false;
      for (const term of unresolved) {
        const element = island.elements.find((e) => e.id === term.componentId);
        if (!element) continue;
        used = true;
        remaining.delete(term.componentId);
        const current = currentWeights(island, element, work);
        current.forEach(
          (v, i) => (weights[i] = work.q.add(weights[i], work.q.mul(v, term.coefficient))),
        );
      }
      if (!used) continue;
      const queried = queryIsland(island, weights, work);
      if (queried.status !== 'unique') return queried;
      value = work.q.add(value, queried.value);
    }
    return remaining.size ? { status: 'unverified' } : { status: 'unique', value };
  } catch (error) {
    if (!(error instanceof BudgetExceeded)) throw error;
    return { status: 'unverified' };
  }
}

export function solvePiecewise(circuit: CompiledCircuit, options: SolveOptions): SimulationResult {
  const result = empty(),
    work = createSolveWork(),
    { q } = work;
  const physicalModel = options.physicalModel ?? 'textbook';
  result.provenance = {
    physicalModel,
    profileRevision: profileRevision(circuit, options),
    arithmeticQuality: 'exact',
  };
  const netIds = new Set(circuit.nets.map((n) => n.id));
  try {
    const exactValue = (value: Rational | undefined, positive: boolean) =>
      q.isRational(value) &&
      !value.approximation &&
      (positive ? q.sign(value) > 0 : q.sign(value) >= 0);
    const validProfile = (e: CompiledElement) =>
      e.type === 'dc-voltage-source'
        ? exactValue(e.operatingProfile?.sourceResistanceOhm, true)
        : e.type !== 'diode' ||
          (exactValue(e.operatingProfile?.diodeOnResistanceOhm, true) &&
            exactValue(e.operatingProfile?.diodeThresholdV, false));
    const invalid = ordered(circuit.elements).filter(
      (e) =>
        !q.isRational(e.value) ||
        e.value.approximation ||
        !netIds.has(e.a) ||
        !netIds.has(e.b) ||
        (resistive(e) && q.sign(e.value) < 0) ||
        (physicalModel === 'component' && !validProfile(e)),
    );
    if (invalid.length) {
      result.diagnostics.push(
        diagnostic(
          'INVALID_COMPONENT_VALUE',
          invalid.map((e) => e.id),
        ),
      );
      result.solution = 'unverified';
      return result;
    }
    if (!netIds.size) {
      result.status = 'warning';
      result.diagnostics.push(diagnostic('EMPTY_CIRCUIT', [], 'info'));
      return result;
    }
    const islands = split(circuit, options);
    contexts.set(result.nodeVoltages, { islands, work });
    let unverified = false,
      infeasible = false,
      nonunique = false;
    for (const island of islands) {
      try {
        const conflict = physicalModel === 'textbook' ? voltageConflict(island, work) : null;
        if (conflict) {
          infeasible = true;
          result.diagnostics.push(diagnostic('INFEASIBLE_OPERATING_POINT', conflict));
          continue;
        }
        const diodes = island.elements.filter((e) => e.type === 'diode');
        if (diodes.length > 10) throw new BudgetExceeded('operation-limit');
        for (let mask = 0; mask < 2 ** diodes.length; mask++) {
          work.candidate();
          work.matrix(island.voltageIds.length + island.constraints.length);
          const original = mna(island.elements, island.constraints, island.voltageIds),
            { size } = original;
          const matrix = Array.from({ length: size }, () => Array<Rational>(size).fill(q.ZERO));
          for (const { row, col, value } of original.terms)
            matrix[row][col] = q.add(matrix[row][col], value);
          for (let k = 0; k < island.constraints.length; k++) {
            const e = island.constraints[k],
              row = island.voltageIds.length + k;
            if (e.type === 'diode') {
              const on = Boolean(mask & (2 ** diodes.findIndex((d) => d.id === e.id)));
              if (on) {
                original.rhs[row] =
                  physicalModel === 'component'
                    ? e.operatingProfile!.diodeThresholdV!
                    : q.rational(7n, 10n);
                if (physicalModel === 'component')
                  matrix[row][row] = q.neg(e.operatingProfile!.diodeOnResistanceOhm!);
              } else {
                matrix[row].fill(q.ZERO);
                matrix[row][row] = q.ONE;
              }
            } else if (e.type === 'dc-voltage-source' && physicalModel === 'component')
              matrix[row][row] = q.neg(e.operatingProfile!.sourceResistanceOhm!);
          }
          const variables = affineSolve(matrix, original.rhs, work);
          if (!variables) continue;
          const constraints = diodes.map((e, index) => {
            work.inequality();
            const on = Boolean(mask & (2 ** index));
            const affine = combination(
              variables,
              on ? currentWeights(island, e, work).map(q.neg) : voltageWeights(island, e.a, e.b),
              work,
            );
            const limit = on
              ? q.ZERO
              : physicalModel === 'component'
                ? e.operatingProfile!.diodeThresholdV!
                : q.rational(7n, 10n);
            return { coefficients: affine.coefficients, bound: q.sub(limit, affine.constant) };
          });
          if (feasible(constraints, variables[0]?.coefficients.length ?? 0, work))
            island.spaces.push({ variables, constraints });
        }
        if (!island.spaces.length) {
          infeasible = true;
          result.diagnostics.push(
            diagnostic(
              'INFEASIBLE_OPERATING_POINT',
              island.elements.map((e) => e.id),
            ),
          );
          continue;
        }
        island.spaces = selectEquilibrium(
          island.spaces,
          diodes.map((e) => voltageWeights(island, e.a, e.b)),
          work,
        );
        island.valid = true;
        for (const id of island.nets) {
          const value = queryIsland(island, voltageWeights(island, id), work);
          if (value.status === 'unique') result.nodeVoltages[id] = value.value;
          else nonunique = true;
        }
        for (const e of island.elements) {
          const voltage = queryIsland(island, voltageWeights(island, e.a, e.b), work),
            current = queryIsland(island, currentWeights(island, e, work), work);
          if (voltage.status === 'unique') result.componentVoltages[e.id] = voltage.value;
          else nonunique = true;
          if (current.status === 'unique') result.branchCurrents[e.id] = current.value;
          else nonunique = true;
          if (current.status === 'unique' && q.sign(current.value) === 0)
            result.componentPowers[e.id] = q.ZERO;
          else if (voltage.status === 'unique' && q.sign(voltage.value) === 0)
            result.componentPowers[e.id] = q.ZERO;
          else if (voltage.status === 'unique' && current.status === 'unique')
            result.componentPowers[e.id] = q.mul(voltage.value, current.value);
        }
      } catch (error) {
        if (!(error instanceof BudgetExceeded) && !(error instanceof EquilibriumVerificationError))
          throw error;
        island.valid = false;
        island.spaces = [];
        unverified = true;
        for (const id of island.nets) delete result.nodeVoltages[id];
        for (const e of island.elements) {
          delete result.branchCurrents[e.id];
          delete result.componentVoltages[e.id];
          delete result.componentPowers[e.id];
        }
        result.diagnostics.push(
          diagnostic(
            'OPERATING_POINT_UNVERIFIED',
            island.elements.map((e) => e.id),
            'warning',
            { reason: error.reason },
          ),
        );
      }
    }
    // Open elements crossing independent islands have zero current but no defined voltage.
    for (const e of circuit.elements.filter((e) => !connects(e))) {
      result.branchCurrents[e.id] = q.ZERO;
      result.componentPowers[e.id] = q.ZERO;
    }
    result.solution = unverified
      ? 'unverified'
      : infeasible
        ? 'infeasible'
        : nonunique
          ? 'nonunique'
          : 'unique';
    const hasValid = islands.some((i) => i.valid);
    if (options.referencePolicy === 'independent')
      result.referenceGroups = islands.filter(i => i.valid && i.reference !== undefined).map(i => ({
        id: i.nets[0], referenceNetId: i.reference!, netIds: [...i.nets],
      }));
    result.status = !hasValid
      ? 'error'
      : unverified || infeasible || nonunique
        ? 'warning'
        : 'solved';
    if (nonunique)
      result.diagnostics.push(
        diagnostic(
          'NONUNIQUE_OPERATING_POINT',
          islands.filter((i) => i.valid).flatMap((i) => i.elements.map((e) => e.id)),
          'info',
        ),
      );
    if (hasValid) result.quality = { mode: 'exact' };
    return result;
  } catch (error) {
    if (!(error instanceof BudgetExceeded)) throw error;
    result.solution = 'unverified';
    result.diagnostics.push(
      diagnostic('OPERATING_POINT_UNVERIFIED', [], 'warning', { reason: error.reason }),
    );
    return result;
  }
}
