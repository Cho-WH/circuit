import type { ComponentInstance } from './index';

export function isAdjustableVoltageSource(component: ComponentInstance): boolean {
  return component.type === 'dc-voltage-source' && component.properties.sourceKind === 'adjustable';
}

/** Shared stored range contract; UI labels and default values belong to the library. */
export function adjustableRangeDefinition(component: ComponentInstance) {
  if (isAdjustableVoltageSource(component))
    return {
      property: 'voltageV',
      minimumProperty: 'voltageMinV',
      maximumProperty: 'voltageMaxV',
      allowZero: true,
    } as const;
  if (component.type === 'resistive-load')
    return {
      property: 'resistanceOhm',
      minimumProperty: 'resistanceMinOhm',
      maximumProperty: 'resistanceMaxOhm',
      allowZero: false,
    } as const;
  return null;
}
