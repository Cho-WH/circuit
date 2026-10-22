import { RcFailure } from './types';

export type NumericMatrix = number[][];
const zeros = (n: number, m = n) => Array.from({ length: n }, () => Array(m).fill(0) as number[]);
export const transpose = (a: NumericMatrix) => a[0]?.map((_, c) => a.map((row) => row[c])) ?? [];
export const multiply = (a: NumericMatrix, b: NumericMatrix) =>
  a.map((row) => (b[0] ?? []).map((_, c) => row.reduce((s, v, i) => s + v * b[i][c], 0)));
export function lowerSolve(l: NumericMatrix, b: NumericMatrix): NumericMatrix {
  const out = zeros(l.length, b[0]?.length ?? 0);
  for (let i = 0; i < l.length; i++)
    for (let c = 0; c < out[i].length; c++) {
      let v = b[i][c];
      for (let j = 0; j < i; j++) v -= l[i][j] * out[j][c];
      out[i][c] = v / l[i][i];
    }
  return out;
}
export function upperSolve(u: NumericMatrix, b: NumericMatrix): NumericMatrix {
  const out = zeros(u.length, b[0]?.length ?? 0);
  for (let i = u.length - 1; i >= 0; i--)
    for (let c = 0; c < out[i].length; c++) {
      let v = b[i][c];
      for (let j = i + 1; j < u.length; j++) v -= u[i][j] * out[j][c];
      out[i][c] = v / u[i][i];
    }
  return out;
}
export function cholesky(a: NumericMatrix): NumericMatrix {
  const l = zeros(a.length);
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j <= i; j++) {
      let v = a[i][j];
      for (let k = 0; k < j; k++) v -= l[i][k] * l[j][k];
      if (i === j) {
        if (!(v > 0) || !Number.isFinite(v))
          throw new RcFailure('RC_NUMERICAL_UNVERIFIED', 'cholesky');
        l[i][j] = Math.sqrt(v);
      } else l[i][j] = v / l[j][j];
    }
  return l;
}

/** Cyclic symmetric Jacobi; this supplies an approximation, not its error certificate. */
export function symmetricEigen(input: NumericMatrix, maxSweeps: number) {
  const n = input.length;
  const scale = Math.max(...input.flat().map(Math.abs));
  if (!(scale > 0) || !Number.isFinite(scale))
    throw new RcFailure('RC_NUMERICAL_UNVERIFIED', 'eigen-scale');
  const a = input.map((row) => row.map((v) => v / scale));
  const vectors = zeros(n);
  for (let i = 0; i < n; i++) vectors[i][i] = 1;
  let converged = false;
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let largest = 0;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        largest = Math.max(largest, Math.abs(a[p][q]));
        if (Math.abs(a[p][q]) <= Number.EPSILON * Math.sqrt(Math.abs(a[p][p] * a[q][q]))) continue;
        const tau = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = (tau >= 0 ? 1 : -1) / (Math.abs(tau) + Math.hypot(1, tau));
        const c = 1 / Math.hypot(1, t),
          s = t * c;
        const off = a[p][q];
        a[p][p] -= t * off;
        a[q][q] += t * off;
        a[p][q] = a[q][p] = 0;
        for (let r = 0; r < n; r++) {
          if (r !== p && r !== q) {
            const x = a[r][p],
              y = a[r][q];
            a[r][p] = a[p][r] = c * x - s * y;
            a[r][q] = a[q][r] = s * x + c * y;
          }
          const x = vectors[r][p],
            y = vectors[r][q];
          vectors[r][p] = c * x - s * y;
          vectors[r][q] = s * x + c * y;
        }
      }
    if (largest <= 8 * Number.EPSILON) {
      converged = true;
      break;
    }
  }
  if (!converged) throw new RcFailure('RC_BUDGET_EXCEEDED', 'jacobi-sweeps');
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => a[i][i] - a[j][j] || i - j);
  const rates = order.map((i) => a[i][i] * scale);
  if (rates.some((v) => !(v > 0) || !Number.isFinite(v)))
    throw new RcFailure('RC_NUMERICAL_UNVERIFIED', 'positive-decay-rate');
  return { rates, vectors: vectors.map((row) => order.map((i) => row[i])) };
}
