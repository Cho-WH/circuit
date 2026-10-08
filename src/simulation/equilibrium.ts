import type { Rational } from '../domain';
import {
  affineSolve,
  combination,
  feasible,
  type Affine,
  type Inequality,
  type SolutionSpace,
  type Work,
} from './solution-space';

export class EquilibriumVerificationError extends Error {
  readonly reason = 'equilibrium-verification';
}

/** Substitute an affine family without selecting arbitrary free-variable values. */
function substitute(value: Affine, variables: Affine[], work: Work): Affine {
  const result = combination(variables, value.coefficients, work);
  result.constant = work.q.add(result.constant, value.constant);
  return result;
}

function constraintsIn(constraints: Inequality[], variables: Affine[], work: Work) {
  return constraints.map((row) => {
    work.inequality();
    const value = combination(variables, row.coefficients, work);
    return { coefficients: value.coefficients, bound: work.q.sub(row.bound, value.constant) };
  });
}

/**
 * Educational DC equilibrium: minimize sum(V_diode²) over the original admissible
 * set. Exact convex KKT conditions select voltages, never leakage currents or a
 * ground for an isolated island. All equally optimal current freedoms survive.
 */
export function selectEquilibrium(
  spaces: SolutionSpace[],
  voltageWeights: Rational[][],
  work: Work,
): SolutionSpace[] {
  const { q } = work;
  let best: Rational | undefined;
  let selected: SolutionSpace[] = [];
  for (const space of spaces) {
    const objective = voltageWeights.map((weights) => combination(space.variables, weights, work));
    const minimum = minimize(space, objective, work);
    if (best === undefined || q.compare(minimum.cost, best) < 0) {
      best = minimum.cost;
      selected = [minimum.space];
    } else if (q.equal(minimum.cost, best)) selected.push(minimum.space);
  }
  return selected;
}

function minimize(space: SolutionSpace, objective: Affine[], work: Work) {
  const { q } = work;
  const cost = (values: Rational[]) => values.reduce((sum, v) => q.add(sum, q.mul(v, v)), q.ZERO);
  if (objective.every((v) => v.coefficients.every((c) => !q.sign(c))))
    return { space, cost: cost(objective.map((v) => v.constant)) };

  const dimensions = space.variables[0].coefficients.length;
  work.matrix(dimensions);
  const hessian = Array.from({ length: dimensions }, () =>
    Array<Rational>(dimensions).fill(q.ZERO),
  );
  const gradient = Array<Rational>(dimensions).fill(q.ZERO);
  for (const v of objective)
    for (let i = 0; i < dimensions; i++) {
      gradient[i] = q.add(gradient[i], q.mul(v.coefficients[i], v.constant));
      for (let j = 0; j < dimensions; j++)
        hessian[i][j] = q.add(hessian[i][j], q.mul(v.coefficients[i], v.coefficients[j]));
    }
  const constraints = space.constraints.filter((row) => row.coefficients.some((c) => q.sign(c)));
  // There is at most one inequality per diode before equilibrium selection.
  // A feasible exact KKT certificate proves the global minimum of this convex face.
  for (let mask = 0; mask < 2 ** constraints.length; mask++) {
    work.equilibriumCandidate();
    const active = constraints.filter((_, i) => Boolean(mask & (2 ** i)));
    const size = dimensions + active.length;
    work.matrix(size);
    const matrix = Array.from({ length: size }, () => Array<Rational>(size).fill(q.ZERO));
    const rhs = [...gradient.map(q.neg), ...active.map((row) => row.bound)];
    for (let i = 0; i < dimensions; i++)
      for (let j = 0; j < dimensions; j++) matrix[i][j] = hessian[i][j];
    active.forEach((row, k) =>
      row.coefficients.forEach((v, i) => {
        matrix[i][dimensions + k] = v;
        matrix[dimensions + k][i] = v;
      }),
    );
    const certificate = affineSolve(matrix, rhs, work);
    if (!certificate) continue;
    const parameters = certificate.slice(0, dimensions);
    const checks = constraintsIn(constraints, parameters, work);
    for (const multiplier of certificate.slice(dimensions)) {
      work.inequality();
      checks.push({ coefficients: multiplier.coefficients.map(q.neg), bound: multiplier.constant });
    }
    if (!feasible(checks, certificate[0]?.coefficients.length ?? 0, work)) continue;
    const voltages = objective.map((v) => substitute(v, parameters, work));
    if (voltages.some((v) => v.coefficients.some((c) => q.sign(c))))
      throw new EquilibriumVerificationError();

    // Keep the complete minimum set, not just the active face used by the
    // certificate. Equal objective vectors are equivalent to these normal equations.
    const target = Array<Rational>(dimensions).fill(q.ZERO);
    objective.forEach((v, k) =>
      v.coefficients.forEach((c, i) => {
        target[i] = q.add(target[i], q.mul(c, q.sub(voltages[k].constant, v.constant)));
      }),
    );
    work.matrix(dimensions);
    const minimumParameters = affineSolve(hessian, target, work);
    if (!minimumParameters) throw new EquilibriumVerificationError();
    const minimum: SolutionSpace = {
      variables: space.variables.map((v) => substitute(v, minimumParameters, work)),
      constraints: constraintsIn(space.constraints, minimumParameters, work),
    };
    if (!feasible(minimum.constraints, minimum.variables[0]?.coefficients.length ?? 0, work))
      throw new EquilibriumVerificationError();
    return { space: minimum, cost: cost(voltages.map((v) => v.constant)) };
  }
  throw new EquilibriumVerificationError();
}
