import { createArithmetic, type Rational } from '../../src/rational';
import { RcFailure, type RcLimits } from './types';

export type Q = Rational;
export interface Matrix {
  rows: number;
  cols: number;
  data: Q[][];
}

export function exactArithmetic(limits: RcLimits) {
  let remainders = 0;
  const q = createArithmetic({
    integer(n) {
      if ((n < 0n ? -n : n).toString(2).length > limits.bits)
        throw new RcFailure('RC_BUDGET_EXCEEDED', 'integer-bits');
    },
    remainder() {
      if (++remainders > limits.remainders)
        throw new RcFailure('RC_BUDGET_EXCEEDED', 'gcd-remainders');
    },
  });
  const make = (
    rows: number,
    cols: number,
    f: (r: number, c: number) => Q = () => q.ZERO,
  ): Matrix => ({
    rows,
    cols,
    data: Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => f(r, c))),
  });
  const eye = (n: number) => make(n, n, (r, c) => (r === c ? q.ONE : q.ZERO));
  const transpose = (a: Matrix) => make(a.cols, a.rows, (r, c) => a.data[c][r]);
  const mul = (a: Matrix, b: Matrix) => {
    if (a.cols !== b.rows) throw new RcFailure('RC_NUMERICAL_UNVERIFIED', 'matrix-shape');
    return make(a.rows, b.cols, (r, c) => q.sum(a.data[r].map((v, k) => q.mul(v, b.data[k][c]))));
  };
  const add = (a: Matrix, b: Matrix) => {
    if (a.rows !== b.rows || a.cols !== b.cols)
      throw new RcFailure('RC_NUMERICAL_UNVERIFIED', 'matrix-shape');
    return make(a.rows, a.cols, (r, c) => q.add(a.data[r][c], b.data[r][c]));
  };
  const scale = (a: Matrix, s: Q) => make(a.rows, a.cols, (r, c) => q.mul(a.data[r][c], s));
  const sub = (a: Matrix, b: Matrix) => add(a, scale(b, q.neg(q.ONE)));
  const cols = (a: Matrix, indices: number[]) =>
    make(a.rows, indices.length, (r, c) => a.data[r][indices[c]]);
  const rows = (a: Matrix, indices: number[]) =>
    make(indices.length, a.cols, (r, c) => a.data[indices[r]][c]);
  const hcat = (a: Matrix, b: Matrix) => {
    if (a.rows !== b.rows) throw new RcFailure('RC_NUMERICAL_UNVERIFIED', 'matrix-shape');
    return make(a.rows, a.cols + b.cols, (r, c) =>
      c < a.cols ? a.data[r][c] : b.data[r][c - a.cols],
    );
  };
  const vcat = (a: Matrix, b: Matrix) => {
    if (a.cols !== b.cols) throw new RcFailure('RC_NUMERICAL_UNVERIFIED', 'matrix-shape');
    return make(a.rows + b.rows, a.cols, (r, c) =>
      r < a.rows ? a.data[r][c] : b.data[r - a.rows][c],
    );
  };
  function rref(a: Matrix, pivotColumns = a.cols) {
    const data = a.data.map((row) => row.slice());
    const pivots: number[] = [];
    for (let c = 0; c < pivotColumns && pivots.length < a.rows; c++) {
      const r = pivots.length;
      let pivot = r;
      while (pivot < a.rows && q.sign(data[pivot][c]) === 0) pivot++;
      if (pivot === a.rows) continue;
      [data[r], data[pivot]] = [data[pivot], data[r]];
      const divisor = data[r][c];
      data[r] = data[r].map((v) => q.div(v, divisor));
      for (let i = 0; i < a.rows; i++) {
        if (i === r || q.sign(data[i][c]) === 0) continue;
        const factor = data[i][c];
        data[i] = data[i].map((v, j) => q.sub(v, q.mul(factor, data[r][j])));
      }
      pivots.push(c);
    }
    return { matrix: { rows: a.rows, cols: a.cols, data }, pivots };
  }
  function solve(a: Matrix, b: Matrix) {
    const { matrix: rr, pivots } = rref(hcat(a, b), a.cols);
    for (let r = pivots.length; r < a.rows; r++)
      if (rr.data[r].slice(a.cols).some((v) => q.sign(v) !== 0)) return null;
    const free = Array.from({ length: a.cols }, (_, i) => i).filter((i) => !pivots.includes(i));
    const particular = make(a.cols, b.cols, (r, c) => {
      const i = pivots.indexOf(r);
      return i < 0 ? q.ZERO : rr.data[i][a.cols + c];
    });
    const kernel = make(a.cols, free.length, (r, c) => {
      const i = pivots.indexOf(r);
      return i < 0 ? (r === free[c] ? q.ONE : q.ZERO) : q.neg(rr.data[i][free[c]]);
    });
    return { particular, kernel, pivots };
  }
  const unique = (a: Matrix, b: Matrix) => {
    const result = solve(a, b);
    if (!result || result.kernel.cols)
      throw new RcFailure('RC_NUMERICAL_UNVERIFIED', 'nonunique-reduction');
    return result.particular;
  };
  const kernel = (a: Matrix) => solve(a, make(a.rows, 0))!.kernel;
  const congruence = (a: Matrix, basis: Matrix) => mul(transpose(basis), mul(a, basis));
  const text = (v: Q) => `${v.numerator}/${v.denominator}`;
  function parse(s: string): Q {
    if (typeof s !== 'string' || s.length > 256) throw new RcFailure('RC_INVALID_INPUT', 'scalar');
    if (/^[+-]?\d+\/[1-9]\d*$/.test(s)) {
      const [n, d] = s.split('/');
      return q.rational(BigInt(n), BigInt(d));
    }
    // Bound exponent before allocating a large power of ten.
    const exponent = s.toLowerCase().split('e')[1];
    if (
      exponent !== undefined &&
      (!/^[+-]?\d+$/.test(exponent) || Math.abs(Number(exponent)) > 300)
    )
      throw new RcFailure('RC_INVALID_INPUT', 'scalar-exponent');
    const result = q.fromDecimal(s);
    if (!result) throw new RcFailure('RC_INVALID_INPUT', 'scalar');
    return result;
  }
  function fromFloat(value: number): Q {
    if (!Number.isFinite(value)) throw new RcFailure('RC_NUMERICAL_UNVERIFIED', 'nonfinite-float');
    if (value === 0) return q.ZERO;
    const data = new DataView(new ArrayBuffer(8));
    data.setFloat64(0, value);
    const bits = data.getBigUint64(0);
    const negative = bits >> 63n !== 0n;
    const exponent = Number((bits >> 52n) & 2047n);
    const mantissa = (bits & ((1n << 52n) - 1n)) + (exponent ? 1n << 52n : 0n);
    const power = (exponent || 1) - 1023 - 52;
    const n = negative ? -mantissa : mantissa;
    return power < 0 ? q.rational(n, 1n << BigInt(-power)) : q.rational(n << BigInt(power));
  }
  return {
    q,
    make,
    eye,
    transpose,
    mul,
    add,
    sub,
    scale,
    cols,
    rows,
    hcat,
    vcat,
    rref,
    solve,
    unique,
    kernel,
    congruence,
    parse,
    text,
    fromFloat,
    usage: () => ({ remainders }),
  };
}
export type Exact = ReturnType<typeof exactArithmetic>;
