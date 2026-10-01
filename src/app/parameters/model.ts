import * as q from '../../rational';
import type { CircuitDocument } from '../../domain';
import type { AdjustableParameter } from '../../component-library';
import { buildCurrentModel } from '../../visualization';
import { analyze } from '../analyze';

/** Changing only this parameter leaves the comparison's reference scales unchanged. */
export function parameterContext(
  document: CircuitDocument,
  id: string,
  parameter: AdjustableParameter,
) {
  return JSON.stringify({
    ...document,
    components: document.components.map((c) =>
      c.id !== id
        ? c
        : {
            ...c,
            properties: Object.fromEntries(
              Object.entries(c.properties).filter(
                ([key]) => key !== parameter.property && key !== parameter.property + 'Fraction',
              ),
            ),
          },
    ),
  });
}

export function parameterScales(
  document: CircuitDocument,
  id: string,
  parameter: AdjustableParameter,
) {
  const voltages: q.Scalar[] = [0],
    relativeVoltages: q.Scalar[] = [0],
    currents: q.Scalar[] = [0];
  // With one positive resistor varied and all other elements fixed, solved quantities
  // are fractional-linear functions of R; their extrema occur at the range endpoints.
  for (const value of [parameter.min, parameter.max]) {
    const sample = {
      ...document,
      components: document.components.map((c) =>
        c.id !== id
          ? c
          : {
              ...c,
              properties: { ...c.properties, [parameter.property]: value },
            },
      ),
    };
    const { compilation, result } = analyze(sample);
    const reference = result.nodeVoltages[compilation.circuit.referenceNetId ?? ''] ?? 0;
    for (const voltage of Object.values(result.nodeVoltages).filter(q.isRational)) {
      voltages.push(voltage);
      relativeVoltages.push(q.sub(voltage, reference));
    }
    currents.push(buildCurrentModel(sample, compilation, result).maxMagnitude);
  }
  const range = (values: q.Scalar[]) => ({
    min: values.reduce<q.Scalar>((a, b) => (q.compare(a, b) < 0 ? a : b), 0),
    max: values.reduce<q.Scalar>((a, b) => (q.compare(a, b) > 0 ? a : b), 0),
  });
  const current = currents.reduce<q.Scalar>((a, b) => (q.compare(a, b) > 0 ? a : b), 0);
  return {
    voltage: range(voltages),
    height: range(relativeVoltages),
    current: q.sign(current) ? current : q.ONE,
  };
}
