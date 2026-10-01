import * as q from '../rational';
import type { ComponentInstance } from '../domain';

/** The adjustable property belongs to the component; gestures and solving belong to the app. */
export interface AdjustableParameter {
  property: string;
  minimumProperty: string;
  maximumProperty: string;
  label: string;
  unit: 'Ω' | 'V';
  min: q.StoredScalar;
  max: q.StoredScalar;
  value: q.StoredScalar;
}

export function adjustableParameter(component: ComponentInstance): AdjustableParameter | null {
  if (component.type !== 'resistive-load') return null;
  const value = q.store(component.properties.resistanceOhm as q.Scalar);
  return {
    property: 'resistanceOhm',
    minimumProperty: 'resistanceMinOhm',
    maximumProperty: 'resistanceMaxOhm',
    label: '저항값',
    unit: 'Ω',
    value,
    min: q.store(
      (component.properties.resistanceMinOhm as q.StoredScalar | undefined) ??
        (q.sign(value) > 0 && q.compare(value, 1) < 0 ? value : 1),
    ),
    max: q.store(
      (component.properties.resistanceMaxOhm as q.StoredScalar | undefined) ??
        (q.compare(value, 100) > 0 ? value : 100),
    ),
  };
}

/** Integer UI steps become exact physical values before entering the document. */
export function parameterValueAt(
  parameter: Pick<AdjustableParameter, 'min' | 'max'>,
  step: number,
  steps = 1000,
): q.StoredScalar {
  const k = Math.max(0, Math.min(steps, Math.round(step)));
  return q.store(
    q.add(
      parameter.min,
      q.mul(q.sub(parameter.max, parameter.min), q.rational(BigInt(k), BigInt(steps))),
    ),
  );
}
