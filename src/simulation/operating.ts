import type {
  CompiledCircuit,
  CompiledElement,
  OperatingQuantity,
  Rational,
  SimulationResult,
} from '../domain';
import * as q from '../rational';
import { solveCircuit } from './solver';

export interface OperatingCause {
  componentId: string;
  level: 'overload' | 'damage';
  reason: OperatingQuantity;
  value: Rational;
  continuousMax: Rational;
  damageAt: Rational;
}
export interface OperatingAssessment {
  status: 'normal' | 'overload' | 'damage' | 'unverified';
  components: OperatingCause[];
  representative?: OperatingCause;
}
const priorities: OperatingQuantity[] = [
  'forwardCurrent',
  'sourceCurrent',
  'power',
  'internalPower',
  'reverseVoltage',
];
const positive = (v: Rational | undefined) =>
  v
    ? q.sign(v) > 0
      ? v
      : { ...q.ZERO, ...(v.approximation ? { approximation: v.approximation } : {}) }
    : undefined;

function burden(
  e: CompiledElement,
  result: SimulationResult,
  quantity: OperatingQuantity,
): Rational | undefined {
  const current = result.branchCurrents[e.id],
    voltage = result.componentVoltages[e.id];
  switch (quantity) {
    case 'forwardCurrent':
      return positive(current);
    case 'sourceCurrent':
      return current ? positive(q.neg(current)) : undefined;
    case 'power':
      return positive(result.componentPowers[e.id]);
    case 'reverseVoltage':
      return voltage ? positive(q.neg(voltage)) : undefined;
    case 'internalPower':
      return current && e.operatingProfile?.sourceResistanceOhm
        ? q.mul(q.mul(current, current), e.operatingProfile.sourceResistanceOhm)
        : undefined;
  }
}

/** Compare unrounded burdens. An error interval crossing a threshold cannot establish that event. */
export function assessOperatingPoint(
  circuit: CompiledCircuit,
  result: SimulationResult,
): OperatingAssessment {
  const components: OperatingCause[] = [];
  let unverified =
    result.solution === 'unverified' ||
    result.solution === 'infeasible' ||
    result.status === 'error';
  for (const e of [...circuit.elements].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const profile = e.operatingProfile;
    if (!profile) {
      if (['diode', 'resistor', 'resistive-load', 'dc-voltage-source'].includes(e.type))
        unverified = true;
      continue;
    }
    for (const reason of priorities) {
      const boundary = profile.boundaries[reason];
      if (!boundary) continue;
      const value = burden(e, result, reason);
      if (
        !value ||
        !q.isRational(value) ||
        !q.isRational(boundary.continuousMax) ||
        !q.isRational(boundary.damageAt) ||
        boundary.continuousMax.approximation ||
        boundary.damageAt.approximation ||
        q.sign(boundary.continuousMax) < 0 ||
        q.compare(boundary.continuousMax, boundary.damageAt) >= 0
      ) {
        unverified = true;
        continue;
      }
      const error = value.approximation?.absoluteError;
      if (error !== undefined && (!Number.isFinite(error) || error === Number.MAX_VALUE)) {
        unverified = true;
        continue;
      }
      const center = { numerator: value.numerator, denominator: value.denominator };
      const lower = error === undefined ? center : q.sub(center, q.from(error)),
        upper = error === undefined ? center : q.add(center, q.from(error));
      const level =
        q.compare(lower, boundary.damageAt) >= 0
          ? 'damage'
          : q.compare(lower, boundary.continuousMax) > 0
            ? 'overload'
            : undefined;
      if (level) components.push({ componentId: e.id, level, reason, value, ...boundary });
      else if (q.compare(upper, boundary.continuousMax) > 0) unverified = true;
    }
  }
  components.sort(
    (a, b) =>
      (a.level === b.level ? 0 : a.level === 'damage' ? -1 : 1) ||
      (a.componentId < b.componentId ? -1 : a.componentId > b.componentId ? 1 : 0) ||
      priorities.indexOf(a.reason) - priorities.indexOf(b.reason),
  );
  const representative = components[0];
  return {
    status: representative?.level ?? (unverified ? 'unverified' : 'normal'),
    components,
    ...(representative ? { representative } : {}),
  };
}

export interface OperatingOptions {
  physicalModel?: 'component';
  continuousAdjustment?: boolean;
}
export function analyzeOperatingCircuit(
  circuit: CompiledCircuit,
  options: OperatingOptions = {},
): { result: SimulationResult; assessment: OperatingAssessment } {
  const textbook = solveCircuit(circuit),
    hasDiodes = circuit.elements.some((e) => e.type === 'diode');
  const needsAssessment =
    hasDiodes ||
    circuit.elements.some(
      (e) => e.operatingProfile && Object.keys(e.operatingProfile.boundaries).length,
    );
  if (!needsAssessment)
    return { result: textbook, assessment: { status: 'unverified', components: [] } };
  const component = solveCircuit(circuit, { physicalModel: 'component' });
  const assessment = assessOperatingPoint(circuit, component),
    textbookAssessment = assessOperatingPoint(circuit, textbook);
  const neededCurrents = circuit.elements.filter(
    (e) => e.type === 'diode' || e.type === 'dc-voltage-source',
  );
  const useComponent =
    options.physicalModel === 'component' ||
    circuit.elements.some((e) => e.explicitCharacteristics) ||
    (hasDiodes && options.continuousAdjustment) ||
    textbook.status === 'error' ||
    textbook.solution === 'infeasible' ||
    neededCurrents.some((e) => !textbook.branchCurrents[e.id]) ||
    textbookAssessment.status === 'overload' ||
    textbookAssessment.status === 'damage' ||
    assessment.status === 'overload' ||
    assessment.status === 'damage';
  return { result: useComponent ? component : textbook, assessment };
}
