import * as q from '../../rational';
import type { CircuitDocument, CompileResult, SimulationResult } from '../../domain';
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
  // The endpoints bound linear resistor circuits. For diodes they only seed the
  // scale; includeCurrentScales adds every verified current point while adjusting.
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

export function includeCurrentScales(
  previous: ReturnType<typeof parameterScales>,
  compilation: CompileResult,
  result: SimulationResult,
  current: q.Scalar,
): ReturnType<typeof parameterScales> {
  const min = (a:q.Scalar,b:q.Scalar)=>q.compare(a,b)<0?a:b;
  const max = (a:q.Scalar,b:q.Scalar)=>q.compare(a,b)>0?a:b;
  const values=Object.values(result.nodeVoltages);
  const reference=result.nodeVoltages[compilation.circuit.referenceNetId??'']??q.ZERO;
  return {
    voltage:{min:values.reduce(min,previous.voltage.min),max:values.reduce(max,previous.voltage.max)},
    height:{min:values.map(v=>q.sub(v,reference)).reduce(min,previous.height.min),max:values.map(v=>q.sub(v,reference)).reduce(max,previous.height.max)},
    current:max(previous.current,current),
  };
}
