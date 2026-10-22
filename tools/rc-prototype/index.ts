import { exactArithmetic, type Matrix, type Q } from './exact';
import { cholesky, lowerSolve, upperSolve, symmetricEigen, transpose, multiply } from './numeric';
import {
  enclose,
  sqrtUpper,
  decay,
  iadd,
  imul,
  magnitude,
  point,
  up,
  type Interval,
} from './interval';
import {
  defaultLimits,
  settlingPolicy,
  RcFailure,
  type RcCircuit,
  type RcElement,
  type RcFrame,
  type RcLimits,
  type RcResult,
  type RcValue,
} from './types';
export type { RcCircuit, RcElement, RcFrame, RcLimits, RcResult, RcValue } from './types';
export { settlingPolicy, defaultLimits } from './types';

interface Observable {
  key: string;
  final: Q;
  initial: Q;
  row: Matrix;
  unit: 'voltage' | 'current' | 'charge';
  observed: boolean;
  capacitance?: Q;
}
interface Series {
  key: string;
  final: Interval;
  finalValue: RcValue;
  initialValue: RcValue;
  coefficients: Interval[];
  dynamicError: number;
  tolerance: number;
  observed: boolean;
  constant: boolean;
}
export interface RcPlan {
  summary: Readonly<{
    policy: string;
    states: number;
    decayingStates: number;
    conservedStates: number;
    referenceGroups: readonly (readonly string[])[];
    settlingTime: number;
    rates: readonly number[];
    uniformEnergyError: number;
    maxNumericalBudgetRatio: number;
    arithmeticRemainders: number;
  }>;
  sample(time: number | 'equilibrium'): RcResult<RcFrame>;
  remaining(time: number): RcResult<Record<string, { bound: number; tolerance: number }>>;
  /** Exact prototype endpoint only; product serialization belongs to C1. */
  equilibriumVoltages(): Readonly<Record<string, string>>;
}
const guarded = <T>(f: () => T): RcResult<T> => {
  try {
    return { ok: true, value: f() };
  } catch (error) {
    if (!(error instanceof RcFailure)) throw error;
    return {
      ok: false,
      diagnostic: { code: error.code, detail: error.detail, affectedIds: error.affectedIds },
    };
  }
};
const sumUpper = (a: number, b: number) => (b === 0 ? a : a === 0 ? b : up(a + b));
const productUpper = (a: number, b: number) => (a === 0 || b === 0 ? 0 : up(a * b));

export function prepareRc(
  input: RcCircuit,
  options: { transition?: boolean; limits?: Partial<RcLimits> } = {},
): RcResult<RcPlan> {
  return guarded(() => {
    const limits = { ...defaultLimits, ...options.limits };
    if (Object.values(limits).some((n) => !Number.isSafeInteger(n) || n < 0))
      throw new RcFailure('RC_INVALID_INPUT', 'limits');
    const e = exactArithmetic(limits),
      { q, make, eye, mul, add, sub, scale, cols, rows, hcat, vcat, unique, kernel, congruence } =
        e;
    const tr = e.transpose;
    const nodes = [...input.nodes].sort();
    const elements = [...input.elements].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (
      new Set(nodes).size !== nodes.length ||
      new Set(elements.map((x) => x.id)).size !== elements.length ||
      !nodes.length ||
      nodes.some((id) => !id) ||
      (input.reference !== undefined && !nodes.includes(input.reference))
    )
      throw new RcFailure('RC_INVALID_INPUT', 'identifiers');
    const nodeIndex = new Map(nodes.map((id, i) => [id, i]));
    const values = new Map<string, Q>();
    for (const item of elements) {
      if (!item.id || !nodeIndex.has(item.a) || !nodeIndex.has(item.b))
        throw new RcFailure('RC_INVALID_INPUT', 'endpoint', [item.id]);
      if (!['resistor', 'capacitor', 'voltage', 'switch'].includes(item.kind))
        throw new RcFailure('RC_UNSUPPORTED_ELEMENT', 'element-kind', [item.id]);
      if (item.kind === 'switch') {
        if (typeof item.closed !== 'boolean')
          throw new RcFailure('RC_INVALID_INPUT', 'switch-state', [item.id]);
        values.set(item.id, q.ZERO);
      } else {
        const value = e.parse(item.value);
        if (
          (item.kind === 'capacitor' && q.sign(value) <= 0) ||
          (item.kind === 'resistor' && q.sign(value) < 0)
        )
          throw new RcFailure('RC_INVALID_INPUT', 'nonpositive-component', [item.id]);
        values.set(item.id, value);
      }
    }
    const caps = elements.filter((x) => x.kind === 'capacitor');
    const sources = elements.filter(
      (x) =>
        x.kind === 'voltage' ||
        (x.kind === 'switch' && x.closed) ||
        (x.kind === 'resistor' && q.sign(values.get(x.id)!) === 0),
    );
    if (caps.length > limits.capacitors || nodes.length + sources.length > limits.unknowns)
      throw new RcFailure('RC_BUDGET_EXCEEDED', 'circuit-size');
    for (const key of Object.keys(input.initialVoltages ?? {}))
      if (!caps.some((c) => c.id === key))
        throw new RcFailure('RC_INVALID_INPUT', 'unknown-initial-state', [key]);
    const initial = new Map(caps.map((c) => [c.id, e.parse(input.initialVoltages?.[c.id] ?? '0')]));
    const active = elements.filter((x) => x.kind !== 'switch' || x.closed);
    const adjacency = new Map(nodes.map((id) => [id, new Set<string>()]));
    for (const item of active) {
      adjacency.get(item.a)!.add(item.b);
      adjacency.get(item.b)!.add(item.a);
    }
    const unseen = new Set(nodes),
      groups: string[][] = [];
    for (const start of nodes) {
      if (!unseen.delete(start)) continue;
      const group = [start];
      for (let i = 0; i < group.length; i++)
        for (const next of adjacency.get(group[i])!) if (unseen.delete(next)) group.push(next);
      groups.push(group.sort());
    }
    const incidence = (item: { a: string; b: string }) =>
      make(1, nodes.length, (_, c) =>
        q.sub(
          c === nodeIndex.get(item.a) ? q.ONE : q.ZERO,
          c === nodeIndex.get(item.b) ? q.ONE : q.ZERO,
        ),
      );
    const capIncidence = make(caps.length, nodes.length, (r, c) => incidence(caps[r]).data[0][c]);
    const sourceIncidence = make(
      sources.length,
      nodes.length,
      (r, c) => incidence(sources[r]).data[0][c],
    );
    const gauge = make(groups.length, nodes.length, (r, c) =>
      nodes[c] === (groups[r].includes(input.reference ?? '') ? input.reference : groups[r][0])
        ? q.ONE
        : q.ZERO,
    );
    const sourceValues = make(sources.length, 1, (r) => values.get(sources[r].id)!);
    const voltageConstraints = vcat(sourceIncidence, gauge);
    const constraintValues = vcat(sourceValues, make(groups.length, 1));
    const constrained = e.solve(voltageConstraints, constraintValues);
    if (!constrained)
      throw new RcFailure(
        'RC_SOURCE_CONFLICT',
        'voltage-constraints',
        sources.map((x) => x.id),
      );
    const checkInitial = e.solve(
      vcat(voltageConstraints, capIncidence),
      vcat(
        constraintValues,
        make(caps.length, 1, (r) => initial.get(caps[r].id)!),
      ),
    );
    if (!checkInitial)
      throw new RcFailure(
        options.transition ? 'RC_IMPULSE_REQUIRED' : 'RC_INITIAL_CONDITION_CONFLICT',
        'capacitor-continuity',
        caps.map((c) => c.id),
      );

    const cNodal = make(nodes.length, nodes.length),
      gNodal = make(nodes.length, nodes.length);
    for (const item of elements) {
      const value = values.get(item.id)!;
      if (item.kind !== 'capacitor' && !(item.kind === 'resistor' && q.sign(value) > 0)) continue;
      const matrix = item.kind === 'capacitor' ? cNodal : gNodal;
      const weight = item.kind === 'capacitor' ? value : q.div(q.ONE, value);
      const a = nodeIndex.get(item.a)!,
        b = nodeIndex.get(item.b)!;
      for (const [r, s, positive] of [
        [a, a, true],
        [b, b, true],
        [a, b, false],
        [b, a, false],
      ] as const)
        matrix.data[r][s] = q.add(matrix.data[r][s], positive ? weight : q.neg(weight));
    }
    const n = constrained.kernel,
      p = constrained.particular;
    const mass = congruence(cNodal, n),
      conductance = congruence(gNodal, n);
    const forcing = scale(mul(tr(n), mul(gNodal, p)), q.neg(q.ONE));
    const pivots = e.rref(mass).pivots;
    const d = cols(eye(n.cols), pivots),
      z = kernel(mass);
    const m = congruence(mass, d);
    const gzz = congruence(conductance, z);
    const gzd = mul(tr(z), mul(conductance, d));
    const algebraicOffset = unique(gzz, mul(tr(z), forcing));
    const algebraicResponse = unique(gzz, gzd);
    const reducedBasis = sub(d, mul(z, algebraicResponse));
    const nodeOffset = add(p, mul(n, mul(z, algebraicOffset)));
    const nodeBasis = mul(n, reducedBasis);
    const g = sub(congruence(conductance, d), mul(tr(gzd), algebraicResponse));
    const f = sub(mul(tr(d), forcing), mul(tr(gzd), algebraicOffset));
    const initialRight = sub(
      make(caps.length, 1, (r) => initial.get(caps[r].id)!),
      mul(capIncidence, nodeOffset),
    );
    const x0 = unique(mul(capIncidence, nodeBasis), initialRight);
    const conserved = kernel(g);
    const chargeConstraints = mul(tr(conserved), m);
    const equilibriumSolve = e.solve(
      vcat(g, chargeConstraints),
      vcat(f, mul(chargeConstraints, x0)),
    );
    if (!equilibriumSolve)
      throw new RcFailure('RC_NO_FINITE_EQUILIBRIUM', 'conserved-mode-forcing');
    if (equilibriumSolve.kernel.cols)
      throw new RcFailure('RC_NUMERICAL_UNVERIFIED', 'equilibrium-rank');
    const xInfinity = equilibriumSolve.particular;
    const w = kernel(chargeConstraints);
    const md = congruence(m, w),
      gd = congruence(g, w);
    const dx0 = unique(w, sub(x0, xInfinity));
    const nodeFinal = add(nodeOffset, mul(nodeBasis, xInfinity));
    const nodeDynamic = mul(nodeBasis, w);
    const inverseMass = unique(md, eye(md.rows));
    const evolution = mul(inverseMass, gd);

    let rates: number[] = [];
    let amplitudes = make(md.rows, 0);
    let uniformEnergyError = 0;
    if (md.rows) {
      const toNumbers = (matrix: Matrix) => matrix.data.map((row) => row.map((v) => q.toNumber(v)));
      const l = cholesky(toNumbers(md));
      const whitened = transpose(lowerSolve(l, transpose(lowerSolve(l, toNumbers(gd)))));
      for (let r = 0; r < whitened.length; r++)
        for (let c = 0; c < r; c++)
          whitened[r][c] = whitened[c][r] = (whitened[r][c] + whitened[c][r]) / 2;
      const eigen = symmetricEigen(whitened, limits.jacobiSweeps);
      rates = eigen.rates;
      const y0 = multiply(transpose(l), toNumbers(dx0));
      const modalInitial = multiply(transpose(eigen.vectors), y0);
      const basis = upperSolve(transpose(l), eigen.vectors);
      amplitudes = make(md.rows, md.rows, (r, c) => e.fromFloat(basis[r][c] * modalInitial[c][0]));
      // Exact residual of the binary64 candidate against the exact reduced circuit.
      // Passivity gives ||error(t)||_M <= ||initial mismatch||_M + sum ||residual_k||_(M^-1) / rate_k.
      const initialMismatch = sub(
        dx0,
        mul(
          amplitudes,
          make(amplitudes.cols, 1, () => q.ONE),
        ),
      );
      uniformEnergyError = sqrtUpper(e, congruence(md, initialMismatch).data[0][0]);
      for (let k = 0; k < rates.length; k++) {
        const a = cols(amplitudes, [k]);
        const residual = sub(mul(gd, a), scale(mul(md, a), e.fromFloat(rates[k])));
        const norm = sqrtUpper(e, congruence(inverseMass, residual).data[0][0]);
        uniformEnergyError = sumUpper(uniformEnergyError, norm === 0 ? 0 : up(norm / rates[k]));
      }
      if (!Number.isFinite(uniformEnergyError))
        throw new RcFailure('RC_NUMERICAL_UNVERIFIED', 'residual-bound-range');
      // Only identical candidate rates can be combined without changing the certified response.
      // Nearby rates stay separate; their closeness is not evidence of exact degeneracy.
      const distinctRates = [...new Set(rates)];
      const combined = make(amplitudes.rows, distinctRates.length, (r, c) =>
        q.sum(amplitudes.data[r].filter((_, k) => rates[k] === distinctRates[c])),
      );
      rates = distinctRates;
      amplitudes = combined;
    }

    const observables: Observable[] = [];
    const addObservable = (
      key: string,
      final: Q,
      row: Matrix,
      unit: Observable['unit'],
      observed: boolean,
      capacitance?: Q,
    ) => {
      observables.push({
        key,
        final,
        row,
        initial: q.add(final, mul(row, dx0).data[0][0]),
        unit,
        observed,
        capacitance,
      });
    };
    for (let i = 0; i < nodes.length; i++)
      addObservable(
        `node:${nodes[i]}`,
        nodeFinal.data[i][0],
        rows(nodeDynamic, [i]),
        'voltage',
        false,
      );
    for (const group of groups)
      for (let i = 0; i < group.length; i++)
        for (let j = i + 1; j < group.length; j++) {
          const b = incidence({ a: group[i], b: group[j] });
          addObservable(
            `pair:${JSON.stringify([group[i], group[j]])}`,
            mul(b, nodeFinal).data[0][0],
            mul(b, nodeDynamic),
            'voltage',
            true,
          );
        }
    const sourceRhs = hcat(
      scale(mul(gNodal, nodeFinal), q.neg(q.ONE)),
      scale(sub(mul(gNodal, nodeDynamic), mul(cNodal, mul(nodeDynamic, evolution))), q.neg(q.ONE)),
    );
    const sourceCurrents = e.solve(tr(sourceIncidence), sourceRhs);
    if (!sourceCurrents) throw new RcFailure('RC_NUMERICAL_UNVERIFIED', 'source-current-kcl');
    const unknownCurrents = new Set<string>();
    for (const item of elements) {
      const b = incidence(item),
        v = mul(b, nodeFinal).data[0][0],
        h = mul(b, nodeDynamic);
      addObservable(`voltage:${item.id}`, v, h, 'voltage', true);
      const value = values.get(item.id)!;
      if (item.kind === 'capacitor') {
        addObservable(
          `charge:${item.id}`,
          q.mul(value, v),
          scale(h, value),
          'charge',
          false,
          value,
        );
        addObservable(
          `current:${item.id}`,
          q.ZERO,
          scale(mul(h, evolution), q.neg(value)),
          'current',
          true,
        );
      } else if (item.kind === 'resistor' && q.sign(value) > 0) {
        addObservable(
          `current:${item.id}`,
          q.div(v, value),
          scale(h, q.div(q.ONE, value)),
          'current',
          true,
        );
      } else if (item.kind === 'switch' && !item.closed) {
        addObservable(`current:${item.id}`, q.ZERO, make(1, md.rows), 'current', true);
      } else {
        const index = sources.findIndex((source) => source.id === item.id);
        if (sourceCurrents.kernel.data[index].some((v) => q.sign(v) !== 0))
          unknownCurrents.add(item.id);
        else
          addObservable(
            `current:${item.id}`,
            sourceCurrents.particular.data[index][0],
            make(1, md.rows, (_, c) => sourceCurrents.particular.data[index][c + 1]),
            'current',
            true,
          );
      }
    }
    // Open switches between independent groups have no unique voltage difference.
    const unknownVoltages = new Set(
      elements
        .filter(
          (item) =>
            item.kind === 'switch' &&
            !item.closed &&
            !groups.some((group) => group.includes(item.a) && group.includes(item.b)),
        )
        .map((item) => item.id),
    );

    const scalar = (x: Q): RcValue => {
      const interval = enclose(e, x),
        value = q.toNumber(x);
      return {
        value,
        absoluteError: Math.max(value - interval[0], interval[1] - value),
        exact: e.text(x),
      };
    };
    let maxNumericalBudgetRatio = 0;
    const series = observables
      .filter((o) => !o.key.startsWith('voltage:') || !unknownVoltages.has(o.key.slice(8)))
      .map((o): Series => {
        const a = mul(o.row, amplitudes).data[0];
        const norm = sqrtUpper(e, mul(mul(o.row, inverseMass), tr(o.row)).data[0][0]);
        const dynamicError = productUpper(norm, uniformEnergyError);
        const absolute =
          o.unit === 'current'
            ? e.parse(String(settlingPolicy.currentAbsolute))
            : o.unit === 'charge'
              ? q.mul(o.capacitance!, e.parse(String(settlingPolicy.voltageAbsolute)))
              : e.parse(String(settlingPolicy.voltageAbsolute));
        const toleranceQ = q.add(
          absolute,
          q.mul(e.parse(String(settlingPolicy.relative)), q.sum(a.map(q.abs))),
        );
        const tolerance = enclose(e, toleranceQ)[0];
        if (!(tolerance > 0) || !Number.isFinite(tolerance))
          throw new RcFailure('RC_NUMERICAL_UNVERIFIED', 'tolerance-range');
        maxNumericalBudgetRatio = Math.max(
          maxNumericalBudgetRatio,
          dynamicError / (settlingPolicy.numericalFraction * tolerance),
        );
        if (dynamicError > settlingPolicy.numericalFraction * tolerance)
          throw new RcFailure('RC_NUMERICAL_UNVERIFIED', `residual-budget:${o.key}`);
        return {
          key: o.key,
          final: enclose(e, o.final),
          finalValue: scalar(o.final),
          initialValue: scalar(o.initial),
          coefficients: a.map((v) => enclose(e, v)),
          dynamicError,
          tolerance,
          observed: o.observed,
          constant: o.row.data[0].every((v) => q.sign(v) === 0),
        };
      });
    const remaining = (time: number) => {
      if (!Number.isFinite(time) || time < 0) throw new RcFailure('RC_INVALID_INPUT', 'time');
      const exps = rates.map((rate) => decay(rate, time));
      return Object.fromEntries(
        series
          .filter((s) => s.observed)
          .map((s) => {
            const bound = s.coefficients.reduce(
              (sum, a, k) => sumUpper(sum, productUpper(magnitude(a), exps[k][1])),
              s.dynamicError,
            );
            return [s.key, { bound, tolerance: s.tolerance }];
          }),
      );
    };
    const settled = (time: number) =>
      Object.values(remaining(time)).every((v) => v.bound <= v.tolerance);
    let settlingTime = 0;
    if (!settled(0)) {
      let low = 0,
        high = rates.length ? 1 / Math.max(...rates) : 1;
      let expansions = 0;
      while (Number.isFinite(high) && !settled(high) && expansions < limits.searchExpansions) {
        low = high;
        high *= 2;
        expansions++;
      }
      if (!Number.isFinite(high) || !settled(high))
        throw new RcFailure('RC_BUDGET_EXCEEDED', 'settling-search');
      for (let i = 0; i < limits.searchIterations; i++) {
        const mid = low + (high - low) / 2;
        if (mid === low || mid === high) break;
        if (settled(mid)) high = mid;
        else low = mid;
      }
      settlingTime = high;
    }
    const sample = (time: number | 'equilibrium'): RcFrame => {
      if (time !== 'equilibrium' && (!Number.isFinite(time) || time < 0))
        throw new RcFailure('RC_INVALID_INPUT', 'time');
      const exps = time === 'equilibrium' ? [] : rates.map((rate) => decay(rate, time));
      const frame: RcFrame = {
        time: time === 'equilibrium' ? { kind: 'equilibrium' } : { kind: 'finite', seconds: time },
        nodeVoltages: Object.create(null),
        voltages: Object.create(null),
        currents: Object.create(null),
        charges: Object.create(null),
        undefinedVoltages: [...unknownVoltages],
      };
      for (const s of series) {
        if (s.key.startsWith('pair:')) continue;
        let result: RcValue;
        if (time === 'equilibrium' || s.constant) result = { ...s.finalValue };
        else if (time === 0) result = { ...s.initialValue };
        else {
          const range = s.coefficients.reduce((sum, a, k) => {
            if (a[0] === 0 && a[1] === 0) return sum;
            return iadd(sum, imul(a, exps[k]));
          }, s.final);
          const value = range[0] / 2 + range[1] / 2;
          const error = sumUpper(s.dynamicError, up(Math.max(value - range[0], range[1] - value)));
          if (!Number.isFinite(value) || error > settlingPolicy.numericalFraction * s.tolerance)
            throw new RcFailure('RC_NUMERICAL_UNVERIFIED', `sample-budget:${s.key}`);
          result = { value, absoluteError: error };
        }
        const colon = s.key.indexOf(':'),
          kind = s.key.slice(0, colon),
          id = s.key.slice(colon + 1);
        if (kind === 'node') frame.nodeVoltages[id] = result;
        else if (kind === 'voltage') frame.voltages[id] = result;
        else if (kind === 'current') frame.currents[id] = result;
        else if (kind === 'charge') frame.charges[id] = result;
      }
      for (const id of unknownCurrents) frame.currents[id] = null;
      return frame;
    };
    const equilibriumVoltages = Object.freeze(
      Object.fromEntries(
        caps.map((cap) => {
          const o = observables.find((o) => o.key === `voltage:${cap.id}`)!;
          return [cap.id, e.text(o.final)];
        }),
      ),
    );
    return Object.freeze({
      summary: Object.freeze({
        policy: settlingPolicy.id,
        states: m.rows,
        decayingStates: md.rows,
        conservedStates: conserved.cols,
        referenceGroups: Object.freeze(groups.map((group) => Object.freeze([...group]))),
        settlingTime,
        rates: Object.freeze([...rates]),
        uniformEnergyError,
        maxNumericalBudgetRatio,
        arithmeticRemainders: e.usage().remainders,
      }),
      sample: (time: number | 'equilibrium') => guarded(() => sample(time)),
      remaining: (time: number) => guarded(() => remaining(time)),
      equilibriumVoltages: () => equilibriumVoltages,
    });
  });
}
