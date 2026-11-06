/** C0-only netlist. This is deliberately not a CircuitDocument or a persistence format. */
export type RcElement =
  | { id: string; kind: 'resistor' | 'capacitor' | 'voltage'; a: string; b: string; value: string }
  | { id: string; kind: 'switch'; a: string; b: string; closed: boolean };
export interface RcCircuit {
  nodes: string[];
  elements: RcElement[];
  initialVoltages?: Record<string, string>;
  /** A reference changes coordinates, never capacitor voltage or charge. */
  reference?: string;
}
export type RcCode =
  | 'RC_INVALID_INPUT'
  | 'RC_UNSUPPORTED_ELEMENT'
  | 'RC_INITIAL_CONDITION_CONFLICT'
  | 'RC_IMPULSE_REQUIRED'
  | 'RC_SOURCE_CONFLICT'
  | 'RC_NO_FINITE_EQUILIBRIUM'
  | 'RC_NUMERICAL_UNVERIFIED'
  | 'RC_BUDGET_EXCEEDED';
export class RcFailure extends Error {
  constructor(
    public code: RcCode,
    public detail: string,
    public affectedIds: string[] = [],
  ) {
    super(code);
  }
}
export type RcResult<T> =
  | { ok: true; value: T }
  | { ok: false; diagnostic: { code: RcCode; detail: string; affectedIds: string[] } };
export interface RcLimits {
  capacitors: number;
  unknowns: number;
  bits: number;
  remainders: number;
  jacobiSweeps: number;
  searchExpansions: number;
  searchIterations: number;
}
export const defaultLimits: Readonly<RcLimits> = Object.freeze({
  capacitors: 32,
  unknowns: 256,
  bits: 4096,
  remainders: 5_000_000,
  jacobiSweeps: 80,
  searchExpansions: 256,
  searchIterations: 80,
});
export const settlingPolicy = Object.freeze({
  id: 'rc-c0-envelope-1',
  relative: 0.001,
  voltageAbsolute: 1e-6,
  currentAbsolute: 1e-12,
  numericalFraction: 0.01,
});
export interface RcValue {
  value: number;
  absoluteError: number;
  /** Exact finite/equilibrium scalars only; approximation is never disguised as a fraction. */
  exact?: string;
}
export interface RcFrame {
  time: { kind: 'finite'; seconds: number } | { kind: 'equilibrium' };
  nodeVoltages: Record<string, RcValue>;
  voltages: Record<string, RcValue>;
  undefinedVoltages: string[];
  currents: Record<string, RcValue | null>;
  charges: Record<string, RcValue>;
}
