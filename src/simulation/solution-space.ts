import type { Rational } from '../domain';
import * as arithmetic from '../rational';
import { BudgetExceeded, createBudget } from './budget';

export const diodeBudget = Object.freeze({
  candidates: 1024,
  equilibriumCandidates: 4096,
  inequalities: 25000,
  matrixEntries: 1000000,
});
export function createSolveWork() {
  let candidates = 0,
    equilibriumCandidates = 0,
    inequalities = 0,
    matrixEntries = 0;
  return {
    q: arithmetic.createArithmetic(createBudget()),
    candidate() {
      if (++candidates > diodeBudget.candidates) throw new BudgetExceeded('operation-limit');
    },
    equilibriumCandidate() {
      if (++equilibriumCandidates > diodeBudget.equilibriumCandidates)
        throw new BudgetExceeded('operation-limit');
    },
    inequality() {
      if (++inequalities > diodeBudget.inequalities) throw new BudgetExceeded('operation-limit');
    },
    matrix(size: number) {
      matrixEntries += size * (size + 1);
      if (matrixEntries > diodeBudget.matrixEntries) throw new BudgetExceeded('operation-limit');
    },
  };
}
export type Work = ReturnType<typeof createSolveWork>;
export interface Affine {
  constant: Rational;
  coefficients: Rational[];
}
export interface Inequality {
  coefficients: Rational[];
  bound: Rational;
}
export interface SolutionSpace {
  variables: Affine[];
  constraints: Inequality[];
}
export type QuantityQuery =
  | { status: 'unique'; value: Rational }
  | { status: 'nonunique'; minimum?: Rational; maximum?: Rational }
  | { status: 'unverified' };

/** Rank-revealing exact elimination: a missing pivot is a free variable, not a contradiction. */
export function affineSolve(matrix: Rational[][], rhs: Rational[], work: Work): Affine[] | null {
  const { q } = work,
    size = rhs.length;
  const rows = matrix.map((row, i) => [...row, rhs[i]]),
    pivots: number[] = [];
  let rank = 0;
  for (let column = 0; column < size; column++) {
    const pivot = rows.findIndex((row, i) => i >= rank && q.sign(row[column]) !== 0);
    if (pivot < 0) continue;
    [rows[rank], rows[pivot]] = [rows[pivot], rows[rank]];
    const scale = rows[rank][column];
    for (let j = column; j <= size; j++) rows[rank][j] = q.div(rows[rank][j], scale);
    for (let i = 0; i < size; i++) {
      if (i === rank || !q.sign(rows[i][column])) continue;
      const factor = rows[i][column];
      for (let j = column; j <= size; j++)
        rows[i][j] = q.sub(rows[i][j], q.mul(factor, rows[rank][j]));
    }
    pivots.push(column);
    rank++;
  }
  if (rows.some((row) => row.slice(0, size).every((v) => !q.sign(v)) && q.sign(row[size])))
    return null;
  const free = Array.from({ length: size }, (_, i) => i).filter((i) => !pivots.includes(i));
  const variables = Array.from(
    { length: size },
    (): Affine => ({ constant: q.ZERO, coefficients: free.map(() => q.ZERO) }),
  );
  free.forEach((column, i) => (variables[column].coefficients[i] = q.ONE));
  pivots.forEach((column, i) => {
    variables[column].constant = rows[i][size];
    variables[column].coefficients = free.map((j) => q.neg(rows[i][j]));
  });
  // Verify the entire affine family against the original equations, including KCL.
  for (let i = 0; i < size; i++) {
    const actual = combination(variables, matrix[i], work);
    if (!q.equal(actual.constant, rhs[i]) || actual.coefficients.some((v) => q.sign(v)))
      throw new Error('Invalid exact affine solution');
  }
  return variables;
}

export function combination(variables: Affine[], weights: Rational[], { q }: Work): Affine {
  const result: Affine = {
    constant: q.ZERO,
    coefficients: (variables[0]?.coefficients ?? []).map(() => q.ZERO),
  };
  variables.forEach((v, i) => {
    if (!q.sign(weights[i])) return;
    result.constant = q.add(result.constant, q.mul(weights[i], v.constant));
    v.coefficients.forEach(
      (coefficient, j) =>
        (result.coefficients[j] = q.add(result.coefficients[j], q.mul(weights[i], coefficient))),
    );
  });
  return result;
}

function normalize(constraints: Inequality[], work: Work): Inequality[] | null {
  const { q } = work,
    distinct = new Map<string, Inequality>();
  for (const item of constraints) {
    const first = item.coefficients.find((v) => q.sign(v));
    if (!first) {
      if (q.sign(item.bound) < 0) return null;
      continue;
    }
    const divisor = q.abs(first);
    const coefficients = item.coefficients.map((v) => q.div(v, divisor));
    const bound = q.div(item.bound, divisor);
    const key = coefficients.map((v) => `${v.numerator}/${v.denominator}`).join(',');
    const previous = distinct.get(key);
    if (!previous || q.compare(bound, previous.bound) < 0)
      distinct.set(key, { coefficients, bound });
  }
  return [...distinct.values()];
}

/** Bounded Fourier–Motzkin projection. Duplicate half-spaces are normalized at each step. */
function eliminate(constraints: Inequality[], count: number, work: Work): Inequality[] | null {
  const { q } = work;
  let rows = normalize(constraints, work);
  for (let column = 0; column < count && rows; column++) {
    const positive = rows.filter((r) => q.sign(r.coefficients[0]) > 0);
    const negative = rows.filter((r) => q.sign(r.coefficients[0]) < 0);
    const next = rows
      .filter((r) => !q.sign(r.coefficients[0]))
      .map((r) => ({ coefficients: r.coefficients.slice(1), bound: r.bound }));
    for (const p of positive)
      for (const n of negative) {
        work.inequality();
        const a = p.coefficients[0],
          b = q.neg(n.coefficients[0]);
        next.push({
          coefficients: p.coefficients
            .slice(1)
            .map((v, i) => q.add(q.div(v, a), q.div(n.coefficients[i + 1], b))),
          bound: q.add(q.div(p.bound, a), q.div(n.bound, b)),
        });
      }
    rows = normalize(next, work);
  }
  return rows;
}

export function feasible(constraints: Inequality[], dimensions: number, work: Work): boolean {
  return eliminate(constraints, dimensions, work) !== null;
}

export function querySpace(space: SolutionSpace, weights: Rational[], work: Work): QuantityQuery {
  const { q } = work,
    value = combination(space.variables, weights, work);
  if (value.coefficients.every((v) => !q.sign(v)))
    return { status: 'unique', value: value.constant };
  const constraints = space.constraints.map((r) => ({
    coefficients: [...r.coefficients, q.ZERO],
    bound: r.bound,
  }));
  work.inequality();
  work.inequality();
  constraints.push({
    coefficients: [...value.coefficients.map(q.neg), q.ONE],
    bound: value.constant,
  });
  constraints.push({
    coefficients: [...value.coefficients, q.neg(q.ONE)],
    bound: q.neg(value.constant),
  });
  const projected = eliminate(constraints, value.coefficients.length, work);
  if (!projected) return { status: 'unverified' };
  let minimum: Rational | undefined, maximum: Rational | undefined;
  for (const row of projected) {
    const sign = q.sign(row.coefficients[0]);
    if (!sign) continue;
    const bound = q.div(row.bound, row.coefficients[0]);
    if (sign > 0 && (!maximum || q.compare(bound, maximum) < 0)) maximum = bound;
    if (sign < 0 && (!minimum || q.compare(bound, minimum) > 0)) minimum = bound;
  }
  if (minimum && maximum && q.equal(minimum, maximum)) return { status: 'unique', value: minimum };
  return { status: 'nonunique', ...(minimum ? { minimum } : {}), ...(maximum ? { maximum } : {}) };
}
