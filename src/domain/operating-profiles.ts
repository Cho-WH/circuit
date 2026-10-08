import { isStoredScalar, type ComponentProperties, type Rational } from './scalar';

export type PhysicalModel = 'textbook' | 'component';
export type OperatingQuantity = 'forwardCurrent' | 'power' | 'reverseVoltage' | 'sourceCurrent' | 'internalPower';
export interface OperatingBoundary { continuousMax: Rational; damageAt: Rational }
export interface OperatingProfileRef { id: string; revision: 1 }
export type DiodeKind = 'signal' | 'power';
const diodeProfileIds = { signal: 'edu-diode-signal', power: 'edu-diode-power' } as const;
export function isDiodeKind(value: unknown): value is DiodeKind {
  return value === 'signal' || value === 'power';
}
export function diodeProfileRef(kind: DiodeKind): OperatingProfileRef {
  return { id: diodeProfileIds[kind], revision: 1 };
}
export function diodeKindFor(component: { type: string; operatingProfile?: OperatingProfileRef }): DiodeKind | undefined {
  if (component.type !== 'diode') return undefined;
  return component.operatingProfile?.id === diodeProfileIds.power ? 'power' : 'signal';
}
export function supportsOperatingProfile(type: string, reference: OperatingProfileRef): boolean {
  const expected = defaultOperatingProfileRef(type);
  return reference.revision === 1 && !!expected && (reference.id === expected.id ||
    (type === 'diode' && Object.values(diodeProfileIds).some(id => id === reference.id)));
}
export interface OperatingProfile extends OperatingProfileRef {
  sourceResistanceOhm?: Rational;
  diodeThresholdV?: Rational;
  diodeOnResistanceOhm?: Rational;
  boundaries: Partial<Record<OperatingQuantity, OperatingBoundary>>;
}
export interface SimulationProvenance {
  physicalModel: PhysicalModel;
  profileRevision: string;
  arithmeticQuality: 'exact' | 'approximate';
}

const exact = (numerator: bigint, denominator = 1n): Rational => ({ numerator, denominator });
const boundary = (continuousMax: Rational, damageAt: Rational): OperatingBoundary => ({ continuousMax, damageAt });

/** Fixed educational assumptions, not ratings or failure predictions for a real device.
 * v6 documents with no explicit reference use these revision-1 profiles permanently.
 */
export function defaultOperatingProfileRef(type: string): OperatingProfileRef | undefined {
  const id = type === 'dc-voltage-source' ? 'edu-source' : type === 'diode' ? 'edu-diode' : type === 'resistor' || type === 'resistive-load' ? 'edu-resistor' : undefined;
  return id ? { id, revision: 1 } : undefined;
}

export function operatingProfileFor(component: { type: string; properties: ComponentProperties; operatingProfile?: OperatingProfileRef }): OperatingProfile | undefined {
  const expected = defaultOperatingProfileRef(component.type);
  if (!expected) return undefined;
  const reference = component.operatingProfile ?? expected;
  if (!supportsOperatingProfile(component.type, reference)) return undefined;
  const value = (key: string, fallback: Rational): Rational => {
    const stored = component.properties[key];
    return isStoredScalar(stored) ? { numerator: BigInt(stored.numerator), denominator: BigInt(stored.denominator) } : fallback;
  };
  if (component.type === 'dc-voltage-source') return {
    ...reference, sourceResistanceOhm: value('sourceResistanceOhm', exact(1n)),
    boundaries: { sourceCurrent: boundary(exact(5n), exact(12n)), internalPower: boundary(exact(25n), exact(80n)) },
  };
  if (component.type === 'diode' && reference.id === diodeProfileIds.power) return {
    ...reference, diodeThresholdV: value('diodeThresholdV', exact(7n, 10n)), diodeOnResistanceOhm: value('diodeOnResistanceOhm', exact(1n, 20n)),
    boundaries: {
      forwardCurrent: boundary(exact(6n), exact(10n)),
      power: boundary(exact(6n), exact(12n)),
      reverseVoltage: boundary(exact(1000n), exact(1200n)),
    },
  };
  if (component.type === 'diode') return {
    ...reference, diodeThresholdV: value('diodeThresholdV', exact(7n, 10n)), diodeOnResistanceOhm: value('diodeOnResistanceOhm', exact(2n)),
    boundaries: {
      forwardCurrent: boundary(exact(1n, 5n), exact(3n, 4n)),
      power: boundary(exact(3n, 10n), exact(1n)),
      reverseVoltage: reference.id === diodeProfileIds.signal ? boundary(exact(75n), exact(100n)) : boundary(exact(30n), exact(60n)),
    },
  };
  return { ...reference, boundaries: { power: boundary(exact(25n), exact(100n)) } };
}
