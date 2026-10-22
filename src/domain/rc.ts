import type { CompiledCircuit, Diagnostic, Rational, VoltageReferenceGroup, SimulationResult } from './index';

/** Shared observation fields reuse existing renderers; DC solve contracts stay unchanged. */
export interface RcObservation extends SimulationResult {
  rcFrame: RcFrame;
  provenance?: never;
  quality?: never;
}
export type CircuitObservation = SimulationResult | RcObservation;

/** Runtime contracts only. No plan, frame, charge or clock is CircuitDocument state. */
export type RcTime = { kind: 'finite'; seconds: number } | { kind: 'equilibrium' };
export const rcPolicy = Object.freeze({
  model: 'linear-rc' as const,
  modelRevision: 1 as const,
  arithmetic: 'rc-modal-1' as const,
  settling: 'rc-envelope-1' as const,
  relativeTolerance: 0.001,
  voltageAbsoluteV: 1e-6,
  currentAbsoluteA: 1e-12,
  numericalFraction: 0.01,
});
export interface RcFrameContext {
  model: 'linear-rc';
  modelRevision: 1;
  arithmeticPolicy: 'rc-modal-1';
  settlingPolicy: 'rc-envelope-1';
  /** Deterministic identity of the electrical input, not wall-clock time. */
  circuitRevision: string;
  operationIndex: number;
  frameId: string;
  time: RcTime;
}
export interface RcCapacitorState {
  componentId: string;
  aTerminalId: string;
  bTerminalId: string;
  /** Va - Vb, with approximation metadata retained if present. */
  voltageV: Rational;
}
export type RcInitialState = readonly RcCapacitorState[];
export interface RcPrepareRequest {
  circuit: CompiledCircuit;
  initialState: RcInitialState;
  circuitRevision: string;
  operationIndex: number;
  transition: 'initial' | 'operation';
  policy: typeof rcPolicy;
}
export type RcDiagnosticCode =
  | 'RC_INVALID_INPUT'
  | 'RC_UNSUPPORTED_ELEMENT'
  | 'RC_INITIAL_CONDITION_CONFLICT'
  | 'RC_IMPULSE_REQUIRED'
  | 'RC_SOURCE_CONFLICT'
  | 'RC_NO_FINITE_EQUILIBRIUM'
  | 'RC_NUMERICAL_UNVERIFIED'
  | 'RC_BUDGET_EXCEEDED'
  | 'RC_ENGINE_REQUIRED';
export interface RcDiagnostic extends Diagnostic {
  code: RcDiagnosticCode;
}
export type RcResult<T> =
  | { ok: true; value: T; diagnostics: RcDiagnostic[] }
  | { ok: false; diagnostics: RcDiagnostic[] };
export interface RcPlanSummary {
  circuitRevision: string;
  operationIndex: number;
  settlingTimeSeconds: number;
  slowestTimeConstantSeconds: number | null;
  initialState: RcInitialState;
  equilibriumState: RcInitialState;
  policy: typeof rcPolicy;
}
declare const rcPlanBrand: unique symbol;
/** Engine-owned handle; UI cannot inspect matrices or construct a valid plan. */
export interface RcPlan {
  readonly [rcPlanBrand]: true;
  readonly summary: Readonly<RcPlanSummary>;
}
export interface RcFrame {
  context: RcFrameContext;
  quality: 'exact' | 'approximate';
  referenceGroups: VoltageReferenceGroup[];
  nodeVoltages: Record<string, Rational>;
  componentVoltages: Record<string, Rational>;
  branchCurrents: Record<string, Rational>;
  wireCurrents: Record<string, Rational>;
  capacitorCharges: Record<string, Rational>;
  capacitorState: RcInitialState;
  /** Undefined quantities are omitted from maps, not filled with zero. */
  undefinedVoltageIds: string[];
  undefinedCurrentIds: string[];
  undefinedWireCurrentIds: string[];
}
export type RcReading =
  | { status: 'unique'; value: Rational }
  | { status: 'undefined'; reason: 'independent-reference' | 'nonunique' | 'missing-target' }
  | { status: 'error'; diagnostics: RcDiagnostic[] };
export interface RcEngine {
  prepare(request: RcPrepareRequest): RcResult<RcPlan>;
  sample(plan: RcPlan, time: RcTime): RcResult<RcFrame>;
  queryVoltage(frame: RcFrame, firstNetId: string, secondNetId: string): RcReading;
  queryCurrent(
    frame: RcFrame,
    terms: readonly { componentId: string; coefficient: number }[],
  ): RcReading;
  queryWireCurrent(frame: RcFrame, wireId: string): RcReading;
}

export function validRcFrameContext(input: unknown): input is RcFrameContext {
  if (!input || typeof input !== 'object') return false;
  const v = input as RcFrameContext;
  if (
    Object.keys(v).sort().join(',') !==
    'arithmeticPolicy,circuitRevision,frameId,model,modelRevision,operationIndex,settlingPolicy,time'
  )
    return false;
  if (
    v.model !== rcPolicy.model ||
    v.modelRevision !== rcPolicy.modelRevision ||
    v.arithmeticPolicy !== rcPolicy.arithmetic ||
    v.settlingPolicy !== rcPolicy.settling ||
    typeof v.circuitRevision !== 'string' ||
    !v.circuitRevision.trim() ||
    typeof v.frameId !== 'string' ||
    !v.frameId.trim() ||
    !Number.isSafeInteger(v.operationIndex) ||
    v.operationIndex < 0 ||
    !v.time ||
    typeof v.time !== 'object'
  )
    return false;
  return v.time.kind === 'equilibrium'
    ? Object.keys(v.time).length === 1
    : v.time.kind === 'finite' &&
        Object.keys(v.time).length === 2 &&
        Number.isFinite(v.time.seconds) &&
        v.time.seconds >= 0;
}
