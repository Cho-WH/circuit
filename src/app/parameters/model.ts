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
  const voltages = [0],
    relativeVoltages = [0],
    currents = [0];
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
    for (const voltage of Object.values(result.nodeVoltages).filter(Number.isFinite)) {
      voltages.push(voltage);
      relativeVoltages.push(voltage - reference);
    }
    currents.push(buildCurrentModel(sample, compilation, result).maxMagnitude);
  }
  const range = (values: number[]) => ({ min: Math.min(...values), max: Math.max(...values) });
  return {
    voltage: range(voltages),
    height: range(relativeVoltages),
    current: Math.max(...currents) || 1,
  };
}
