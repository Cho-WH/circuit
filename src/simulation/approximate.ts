import type { Approximation, Rational, SimulationResult } from '../domain';
import * as q from '../rational';
import type { Mna } from './mna';

export class ApproximateFailure extends Error {
  constructor(readonly reason: 'range' | 'numerical-instability' | 'residual') {
    super(reason);
  }
}
const finite = (x: number) => {
  if (!Number.isFinite(x)) throw new ApproximateFailure('range');
  return x;
};
const convert = (value: Rational) => {
  const x = finite(q.toNumber(value));
  if (value.numerator !== 0n && x === 0) throw new ApproximateFailure('range');
  return x;
};
// Scaling uses raw ratios, with no BigInt reduction or repeated exact solve.
const ratio = (a: Rational, b: Rational): Rational => ({
  numerator: a.numerator * b.denominator,
  denominator: a.denominator * b.numerator,
});
const norm = (a: number[][]) =>
  Math.max(...a.map((row) => row.reduce((s, v) => s + Math.abs(v), 0)));
export function approximateSolve(
  model: Mna,
  reason: Approximation['reason'],
): {
  x: Rational[];
  quality: NonNullable<SimulationResult['quality']>;
} {
  const n = model.size;
  const rowScale = Array<Rational>(n).fill(q.ONE);
  const populated = new Set<number>();
  for (const t of model.terms) {
    const abs = {
      numerator: t.value.numerator < 0n ? -t.value.numerator : t.value.numerator,
      denominator: t.value.denominator,
    };
    if (!populated.has(t.row) || q.compare(abs, rowScale[t.row]) > 0) rowScale[t.row] = abs;
    populated.add(t.row);
  }
  const scaledTerms = model.terms.map((t) => ({ ...t, value: ratio(t.value, rowScale[t.row]) }));
  const columns = Array<Rational>(n).fill(q.ZERO);
  for (const t of scaledTerms) {
    const magnitude = {
      ...t.value,
      numerator: t.value.numerator < 0n ? -t.value.numerator : t.value.numerator,
    };
    if (q.compare(magnitude, columns[t.col]) > 0) columns[t.col] = magnitude;
  }
  if (columns.some((v) => !v.numerator)) throw new ApproximateFailure('numerical-instability');
  const a = Array.from({ length: n }, () => Array<number>(n).fill(0));
  for (const t of scaledTerms)
    a[t.row][t.col] = finite(a[t.row][t.col] + convert(ratio(t.value, columns[t.col])));
  const b = model.rhs.map((v, i) => convert(ratio(v, rowScale[i])));
  const lu = a.map((row) => [...row]),
    permutation = Array.from({ length: n }, (_, i) => i);
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(lu[i][k]) > Math.abs(lu[pivot][k])) pivot = i;
    if (lu[pivot][k] === 0) throw new ApproximateFailure('numerical-instability');
    [lu[k], lu[pivot]] = [lu[pivot], lu[k]];
    [permutation[k], permutation[pivot]] = [permutation[pivot], permutation[k]];
    for (let i = k + 1; i < n; i++) {
      lu[i][k] = finite(lu[i][k] / lu[k][k]);
      for (let j = k + 1; j < n; j++) lu[i][j] = finite(lu[i][j] - lu[i][k] * lu[k][j]);
    }
  }
  const solve = (rhs: number[]) => {
    const x = permutation.map((i) => rhs[i]);
    for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) x[i] -= lu[i][j] * x[j];
    for (let i = n - 1; i >= 0; i--) {
      for (let j = i + 1; j < n; j++) x[i] -= lu[i][j] * x[j];
      x[i] = finite(x[i] / lu[i][i]);
    }
    return x;
  };
  // The small dense model permits explicit inverse columns for per-variable errors.
  const inverse = Array.from({ length: n }, () => Array<number>(n));
  for (let j = 0; j < n; j++) {
    const column = solve(Array.from({ length: n }, (_, i) => (i === j ? 1 : 0)));
    column.forEach((v, i) => {
      inverse[i][j] = v;
    });
  }
  const condition = finite(norm(a) * norm(inverse));
  const rowTerms = Array<number>(n).fill(0);
  model.terms.forEach((t) => {
    rowTerms[t.row]++;
  });
  const gamma = (n + Math.max(...rowTerms) + 4) * Number.EPSILON;
  if (condition * gamma > 1e-6) throw new ApproximateFailure('numerical-instability');
  const residual = (x: number[]) => {
    const r = a.map((row, i) => b[i] - row.reduce((s, v, j) => s + v * x[j], 0));
    const scale = a.map(
      (row, i) => Math.abs(b[i]) + row.reduce((s, v, j) => s + Math.abs(v * x[j]), 0),
    );
    const backward = Math.max(
      ...r.map((v, i) => (scale[i] === 0 ? (v === 0 ? 0 : Infinity) : Math.abs(v) / scale[i])),
    );
    return { r, scale, backward };
  };
  let x = solve(b),
    check = residual(x),
    refinements = 0;
  while (refinements < 2 && check.backward > 8 * Number.EPSILON) {
    const correction = solve(check.r),
      next = x.map((v, i) => finite(v + correction[i]));
    const nextCheck = residual(next);
    refinements++;
    if (nextCheck.backward >= check.backward) break;
    x = next;
    check = nextCheck;
  }
  if (!Number.isFinite(check.backward) || check.backward > 32 * gamma)
    throw new ApproximateFailure('residual');
  const errors = inverse.map(
    (row) =>
      4 *
      row.reduce(
        (sum, v, j) => sum + Math.abs(v) * (Math.abs(check.r[j]) + gamma * check.scale[j]),
        0,
      ),
  );
  const solution = x.map((v, i): Rational => {
    const value = convert(ratio(q.from(v), columns[i])),
      error = convert(ratio(q.from(errors[i]), columns[i]));
    if (v !== 0 && value === 0) throw new ApproximateFailure('range');
    return {
      ...q.from(value),
      approximation: { reason, policy: 'dc-budget-1', absoluteError: error },
    };
  });
  return {
    x: solution,
    quality: {
      mode: 'approximate',
      reason,
      policy: 'dc-budget-1',
      condition,
      backwardError: check.backward,
      refinements,
    },
  };
}
