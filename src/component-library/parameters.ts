import type { ComponentInstance } from '../domain';

/** The adjustable property belongs to the component; gestures and solving belong to the app. */
export interface AdjustableParameter {
  property: string;
  minimumProperty: string;
  maximumProperty: string;
  label: string;
  unit: 'Ω' | 'V';
  min: number;
  max: number;
  value: number;
}

export function adjustableParameter(component: ComponentInstance): AdjustableParameter | null {
  if (component.type !== 'resistive-load') return null;
  const value = Number(component.properties.resistanceOhm);
  return {
    property: 'resistanceOhm',
    minimumProperty: 'resistanceMinOhm',
    maximumProperty: 'resistanceMaxOhm',
    label: '저항값',
    unit: 'Ω',
    value,
    min: Number(component.properties.resistanceMinOhm ?? (value > 0 ? Math.min(1, value) : 1)),
    max: Number(component.properties.resistanceMaxOhm ?? Math.max(100, value)),
  };
}
