import {
  diagnostic,
  rcPolicy,
  validRcFrameContext,
  type CompiledCircuit,
  type CompiledElement,
  type Rational,
  type RcEngine,
  type RcPlan,
  type RcFrame,
  type RcInitialState,
  type RcPrepareRequest,
  type RcResult,
  type RcReading,
  type RcTime,
  type RcDiagnosticCode,
  type VoltageReferenceGroup,
} from '../../domain';
import * as q from '../../rational';
import { prepareRc, type RcPlan as CorePlan } from './core';
import { exactArithmetic } from './exact';
import {
  RcFailure,
  defaultLimits,
  type RcCircuit,
  type RcFrame as CoreFrame,
  type RcValue,
} from './types';

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const text = (value: Rational) => `${value.numerator}/${value.denominator}`;
const failure = (code: RcDiagnosticCode, reason: string, ids: string[] = []): RcResult<never> => ({
  ok: false,
  diagnostics: [{ ...diagnostic(code, [...ids].sort(compare)), code, parameters: { reason } }],
});
const success = <T>(value: T): RcResult<T> => ({ ok: true, value, diagnostics: [] });
function guard<T>(work: () => RcResult<T>): RcResult<T> {
  try {
    return work();
  } catch (error) {
    if (error instanceof RcFailure) return failure(error.code, error.detail, error.affectedIds);
    return failure('RC_INVALID_INPUT', 'request-shape');
  }
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Collision-free canonical electrical identity. Excludes labels, geometry and DC profiles. */
export function rcCircuitRevision(circuit: CompiledCircuit): string {
  return `linear-rc@1:${JSON.stringify({
    nets: circuit.nets
      .map((n) => [n.id, [...n.endpointIds].sort(compare), [...n.wireIds].sort(compare)])
      .sort((a, b) => compare(a[0] as string, b[0] as string)),
    endpoints: Object.entries(circuit.endpointToNet).sort(([a], [b]) => compare(a, b)),
    elements: [...circuit.elements]
      .sort((a, b) => compare(a.id, b.id))
      .map((e) => [
        e.id,
        e.type,
        e.a,
        e.b,
        text(e.value),
        e.closed,
        ...(e.type === 'capacitor' ? [e.aTerminalId, e.bTerminalId, text(e.initialVoltageV)] : []),
      ]),
    reference: circuit.referenceNetId ?? null,
    wires: Object.entries(circuit.wireCurrentTerms ?? {})
      .sort(([a], [b]) => compare(a, b))
      .map(([id, terms]) => [
        id,
        terms === null
          ? null
          : [...terms]
              .sort((a, b) => compare(a.componentId, b.componentId))
              .map((t) => [t.componentId, t.coefficient]),
      ]),
  })}`;
}
/** Build initial conditions from a successfully compiled document. No wall clock or hidden state. */
export function rcInitialState(circuit: CompiledCircuit): RcInitialState {
  return circuit.elements
    .filter((e): e is Extract<CompiledElement, { type: 'capacitor' }> => e.type === 'capacitor')
    .sort((a, b) => compare(a.id, b.id))
    .map((e) => ({
      componentId: e.id,
      aTerminalId: e.aTerminalId,
      bTerminalId: e.bTerminalId,
      voltageV: { ...e.initialVoltageV },
    }));
}

function scalar(value: RcValue): Rational {
  const arithmetic = exactArithmetic(defaultLimits);
  if (value.exact !== undefined) return arithmetic.parse(value.exact);
  // Store the exact binary64 centre, not its rounded decimal rendering.
  return {
    ...arithmetic.fromFloat(value.value),
    approximation: {
      reason: 'rc-modal',
      policy: 'rc-modal-1',
      absoluteError: value.absoluteError,
    },
  };
}
type InternalPlan = {
  core: CorePlan;
  request: RcPrepareRequest;
  references: VoltageReferenceGroup[];
  identity: string;
};
type InternalFrame = { plan: InternalPlan; time: number | 'equilibrium'; core: CoreFrame };
const plans = new WeakMap<RcPlan, InternalPlan>();
const frames = new WeakMap<RcFrame, InternalFrame>();

function prepare(request: RcPrepareRequest): RcResult<RcPlan> {
  return guard(() => {
    if (
      !request ||
      !request.circuit ||
      !Array.isArray(request.initialState) ||
      !['initial', 'operation'].includes(request.transition) ||
      !Number.isSafeInteger(request.operationIndex) ||
      request.operationIndex < 0 ||
      !request.policy ||
      Object.keys(request.policy).length !== Object.keys(rcPolicy).length ||
      Object.entries(rcPolicy).some(
        ([key, value]) => request.policy[key as keyof typeof rcPolicy] !== value,
      )
    )
      return failure('RC_INVALID_INPUT', 'request-policy');
    const circuit = request.circuit;
    const elements = [...circuit.elements].sort((a, b) => compare(a.id, b.id));
    const nodes = circuit.nets.map((n) => n.id).sort(compare);
    if (
      !nodes.length ||
      nodes.some((id) => typeof id !== 'string' || !id) ||
      new Set(nodes).size !== nodes.length ||
      new Set(elements.map((e) => e.id)).size !== elements.length ||
      elements.some(
        (e) =>
          typeof e.id !== 'string' ||
          !e.id ||
          !nodes.includes(e.a) ||
          !nodes.includes(e.b) ||
          typeof e.closed !== 'boolean',
      ) ||
      Object.values(circuit.endpointToNet).some((id) => !nodes.includes(id)) ||
      (circuit.referenceNetId !== undefined && !nodes.includes(circuit.referenceNetId))
    )
      return failure('RC_INVALID_INPUT', 'netlist');
    if (
      nodes.length > defaultLimits.unknowns ||
      elements.length > 1024 ||
      Object.keys(circuit.wireCurrentTerms ?? {}).length > 1024
    )
      return failure('RC_BUDGET_EXCEEDED', 'circuit-size');
    const wireIds = [...new Set(circuit.nets.flatMap((n) => n.wireIds))].sort(compare);
    if (
      JSON.stringify(wireIds) !==
      JSON.stringify(Object.keys(circuit.wireCurrentTerms ?? {}).sort(compare))
    )
      return failure('RC_INVALID_INPUT', 'wire-current-topology');
    const unsupported = elements.filter(
      (e) =>
        ![
          'capacitor',
          'resistor',
          'resistive-load',
          'dc-voltage-source',
          'switch',
          'ammeter',
          'voltmeter',
        ].includes(e.type),
    );
    if (unsupported.length)
      return failure(
        'RC_UNSUPPORTED_ELEMENT',
        'element-kind',
        unsupported.map((e) => e.id),
      );
    const arithmetic = exactArithmetic(defaultLimits);
    const exact = (v: Rational, id: string): string => {
      if (!q.isRational(v) || v.denominator <= 0n)
        throw new RcFailure('RC_INVALID_INPUT', 'scalar', [id]);
      if (v.approximation)
        throw new RcFailure('RC_NUMERICAL_UNVERIFIED', 'approximate-input', [id]);
      if (
        [v.numerator, v.denominator].some(
          (n) => (n < 0n ? -n : n).toString(2).length > defaultLimits.bits,
        )
      )
        throw new RcFailure('RC_BUDGET_EXCEEDED', 'integer-bits', [id]);
      const normalized = arithmetic.q.rational(v.numerator, v.denominator);
      if (normalized.numerator !== v.numerator || normalized.denominator !== v.denominator)
        throw new RcFailure('RC_INVALID_INPUT', 'noncanonical-scalar', [id]);
      return text(v);
    };
    for (const e of elements) {
      exact(e.value, e.id);
      if (e.type === 'capacitor') exact(e.initialVoltageV, e.id);
    }
    const caps = rcInitialState(circuit);
    if (
      !caps.length ||
      caps.length !== request.initialState.length ||
      new Set(request.initialState.map((s) => s.componentId)).size !== caps.length
    )
      return failure('RC_INVALID_INPUT', 'capacitor-state-set');
    const initialVoltages: Record<string, string> = Object.create(null);
    const initial: RcInitialState = caps.map((cap) => {
      if (!cap.aTerminalId || !cap.bTerminalId || cap.aTerminalId === cap.bTerminalId)
        throw new RcFailure('RC_INVALID_INPUT', 'capacitor-terminals', [cap.componentId]);
      const element = elements.find((e) => e.id === cap.componentId)!;
      if (
        circuit.endpointToNet[cap.aTerminalId] !== element.a ||
        circuit.endpointToNet[cap.bTerminalId] !== element.b
      )
        throw new RcFailure('RC_INVALID_INPUT', 'capacitor-endpoint-map', [cap.componentId]);
      const state = request.initialState.find((s) => s.componentId === cap.componentId);
      if (!state)
        throw new RcFailure('RC_INVALID_INPUT', 'missing-capacitor-state', [cap.componentId]);
      exact(state.voltageV, cap.componentId);
      const direct = state.aTerminalId === cap.aTerminalId && state.bTerminalId === cap.bTerminalId;
      const reversed =
        state.aTerminalId === cap.bTerminalId && state.bTerminalId === cap.aTerminalId;
      if (!direct && !reversed)
        throw new RcFailure('RC_INVALID_INPUT', 'state-terminal-mismatch', [cap.componentId]);
      const voltageV = direct ? { ...state.voltageV } : q.neg(state.voltageV);
      if (request.transition === 'initial' && !q.equal(voltageV, cap.voltageV))
        throw new RcFailure('RC_INVALID_INPUT', 'document-initial-state-mismatch', [
          cap.componentId,
        ]);
      initialVoltages[cap.componentId] = text(voltageV);
      return { ...cap, voltageV };
    });
    if (request.circuitRevision !== rcCircuitRevision(circuit))
      return failure('RC_INVALID_INPUT', 'circuit-revision');
    const netlist: RcCircuit = {
      nodes,
      reference: circuit.referenceNetId,
      initialVoltages,
      elements: elements.map((e) =>
        e.type === 'switch' || e.type === 'ammeter' || e.type === 'voltmeter'
          ? {
              id: e.id,
              kind: 'switch',
              a: e.a,
              b: e.b,
              closed: e.type === 'ammeter' || (e.type === 'switch' && e.closed),
            }
          : {
              id: e.id,
              kind:
                e.type === 'capacitor'
                  ? 'capacitor'
                  : e.type === 'dc-voltage-source'
                    ? 'voltage'
                    : 'resistor',
              a: e.a,
              b: e.b,
              value: text(e.value),
            },
      ),
      currentObservations: Object.fromEntries(
        Object.entries(circuit.wireCurrentTerms ?? {}).filter(
          (entry): entry is [string, readonly { componentId: string; coefficient: number }[]] =>
            entry[1] !== null,
        ),
      ),
    };
    const result = prepareRc(netlist, { transition: request.transition === 'operation' });
    if (!result.ok)
      return failure(
        result.diagnostic.code,
        result.diagnostic.detail,
        result.diagnostic.affectedIds,
      );
    const core = result.value;
    const equilibrium = core.equilibriumVoltages();
    const summary = freeze({
      circuitRevision: request.circuitRevision,
      operationIndex: request.operationIndex,
      settlingTimeSeconds: core.summary.settlingTime,
      slowestTimeConstantSeconds: core.summary.rates.length
        ? 1 / Math.min(...core.summary.rates)
        : null,
      initialState: initial,
      equilibriumState: caps.map((s) => ({
        ...s,
        voltageV: scalar({ value: 0, absoluteError: 0, exact: equilibrium[s.componentId] }),
      })),
      policy: rcPolicy,
    });
    if (
      summary.slowestTimeConstantSeconds !== null &&
      !Number.isFinite(summary.slowestTimeConstantSeconds)
    )
      return failure('RC_NUMERICAL_UNVERIFIED', 'time-constant-range');
    // The engine alone brands handles. WeakMap membership is the runtime authority.
    const plan = freeze({ summary }) as unknown as RcPlan;
    const references = core.summary.referenceGroups.map((group) => ({
      id: `rc:${group[0]}`,
      referenceNetId: group.includes(circuit.referenceNetId ?? '')
        ? circuit.referenceNetId!
        : (elements.find((e) => e.type === 'dc-voltage-source' && group.includes(e.b))?.b ??
          group[0]),
      netIds: [...group],
    }));
    // Own snapshots: caller mutations cannot change an existing response.
    const snapshot = structuredClone(request);
    snapshot.initialState = initial;
    plans.set(plan, {
      core,
      request: freeze(snapshot),
      references: freeze(references),
      identity: JSON.stringify([
        request.circuitRevision,
        request.operationIndex,
        request.transition,
        initial.map((s) => [s.componentId, text(s.voltageV)]),
      ]),
    });
    return success(plan);
  });
}

function sample(plan: RcPlan, time: RcTime): RcResult<RcFrame> {
  return guard(() => {
    const internal = plans.get(plan);
    if (!internal) return failure('RC_INVALID_INPUT', 'foreign-plan');
    const context = {
      model: rcPolicy.model,
      modelRevision: rcPolicy.modelRevision,
      arithmeticPolicy: rcPolicy.arithmetic,
      settlingPolicy: rcPolicy.settling,
      circuitRevision: internal.request.circuitRevision,
      operationIndex: internal.request.operationIndex,
      frameId: JSON.stringify([internal.identity, time]),
      time,
    };
    if (!validRcFrameContext(context)) return failure('RC_INVALID_INPUT', 'time');
    const at = time.kind === 'equilibrium' ? 'equilibrium' : time.seconds === 0 ? 0 : time.seconds;
    const canonicalTime: RcTime =
      at === 'equilibrium' ? { kind: 'equilibrium' } : { kind: 'finite', seconds: at };
    context.frameId = JSON.stringify([internal.identity, canonicalTime]);
    context.time = canonicalTime;
    const result = internal.core.sample(at);
    if (!result.ok)
      return failure(
        result.diagnostic.code,
        result.diagnostic.detail,
        result.diagnostic.affectedIds,
      );
    const f = result.value;
    const convert = (map: Record<string, RcValue | null>) =>
      Object.fromEntries(
        Object.entries(map)
          .filter((entry): entry is [string, RcValue] => entry[1] !== null)
          .map(([id, v]) => [id, scalar(v)]),
      );
    const componentVoltages = convert(f.voltages);
    const frame: RcFrame = {
      context,
      quality: 'exact',
      referenceGroups: internal.references,
      nodeVoltages: convert(f.nodeVoltages),
      componentVoltages,
      branchCurrents: convert(f.currents),
      wireCurrents: convert(f.observations),
      capacitorCharges: convert(f.charges),
      capacitorState: internal.request.initialState.map((s) => ({
        ...s,
        voltageV: componentVoltages[s.componentId],
      })),
      undefinedVoltageIds: [...f.undefinedVoltages],
      undefinedCurrentIds: Object.keys(f.currents).filter((id) => f.currents[id] === null),
      undefinedWireCurrentIds: Object.keys(internal.request.circuit.wireCurrentTerms ?? {})
        .filter(
          (id) =>
            internal.request.circuit.wireCurrentTerms![id] === null || f.observations[id] === null,
        )
        .sort(compare),
    };
    frame.quality = [
      frame.nodeVoltages,
      frame.componentVoltages,
      frame.branchCurrents,
      frame.wireCurrents,
      frame.capacitorCharges,
    ].some((map) => Object.values(map).some((v) => v.approximation))
      ? 'approximate'
      : 'exact';
    frames.set(frame, { plan: internal, time: at, core: f });
    return success(freeze(frame));
  });
}
const badFrame = (): RcReading => ({
  status: 'error',
  diagnostics: failure('RC_INVALID_INPUT', 'foreign-frame').diagnostics,
});
function queryVoltage(frame: RcFrame, a: string, b: string): RcReading {
  const stored = frames.get(frame);
  if (!stored) return badFrame();
  const group = frame.referenceGroups.find((g) => g.netIds.includes(a));
  if (!group || !frame.referenceGroups.some((g) => g.netIds.includes(b)))
    return { status: 'undefined', reason: 'missing-target' };
  if (!group.netIds.includes(b)) return { status: 'undefined', reason: 'independent-reference' };
  if (a === b) return { status: 'unique', value: q.ZERO };
  const direct = compare(a, b) < 0;
  const value = scalar(stored.core.pairs[JSON.stringify(direct ? [a, b] : [b, a])]);
  return { status: 'unique', value: direct ? value : q.neg(value) };
}
function queryCurrent(
  frame: RcFrame,
  terms: readonly { componentId: string; coefficient: number }[],
): RcReading {
  const stored = frames.get(frame);
  if (!stored) return badFrame();
  const result = guard(() => {
    const core = stored.plan.core.queryCurrent(stored.time, terms);
    return core.ok
      ? success(core.value === null ? null : scalar(core.value))
      : failure(core.diagnostic.code, core.diagnostic.detail, core.diagnostic.affectedIds);
  });
  if (!result.ok) return { status: 'error', diagnostics: result.diagnostics };
  return result.value === null
    ? { status: 'undefined', reason: 'nonunique' }
    : { status: 'unique', value: result.value };
}
function queryWireCurrent(frame: RcFrame, wireId: string): RcReading {
  if (!frames.has(frame)) return badFrame();
  if (Object.hasOwn(frame.wireCurrents, wireId))
    return { status: 'unique', value: frame.wireCurrents[wireId] };
  return {
    status: 'undefined',
    reason: frame.undefinedWireCurrentIds.includes(wireId) ? 'nonunique' : 'missing-target',
  };
}
export const rcEngine: RcEngine = Object.freeze({
  prepare,
  sample,
  queryVoltage,
  queryCurrent,
  queryWireCurrent,
});
