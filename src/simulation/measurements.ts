import { diagnostic, type CompiledCircuit, type Diagnostic, type SimulationResult } from '../domain';
import { solveCircuit } from './solver';

export interface ResistanceResult { status: 'finite' | 'open' | 'short' | 'error'; ohms?: number; diagnostics: Diagnostic[] }
/** ADR-011: remove explicitly external excitation sources, deactivate remaining sources, apply 1 V. */
export function equivalentResistance(circuit: CompiledCircuit, aNet: string, bNet: string, options: { excludeSourceIds?: string[] } = {}): ResistanceResult {
  const ids = new Set(circuit.nets.map(n => n.id));
  const excluded = new Set(options.excludeSourceIds ?? []);
  if (!ids.has(aNet) || !ids.has(bNet) || [...excluded].some(id => !circuit.elements.some(e => e.id === id && e.type === 'dc-voltage-source'))) return { status: 'error', diagnostics: [diagnostic('INVALID_RESISTANCE_PORT', [aNet, bNet])] };
  const elements = circuit.elements.filter(e => !excluded.has(e.id));
  if (elements.some(e => !ids.has(e.a) || !ids.has(e.b) || !Number.isFinite(e.value) || ((e.type === 'resistor' || e.type === 'resistive-load') && e.value < 0))) return { status: 'error', diagnostics: [diagnostic('INVALID_COMPONENT_VALUE')] };
  const parent = new Map([...ids].map(id => [id, id]));
  function root(id: string): string { let p = id; while (parent.get(p) !== p) p = parent.get(p)!; return p; }
  for (const e of elements) if (e.type === 'dc-voltage-source' || e.type === 'ammeter' || (e.type === 'switch' && e.closed) || ((e.type === 'resistor' || e.type === 'resistive-load') && e.value === 0)) {
    const a = root(e.a), b = root(e.b); if (a !== b) parent.set(a > b ? a : b, a > b ? b : a);
  }
  const a = root(aNet), b = root(bNet);
  if (a === b) return { status: 'short', ohms: 0, diagnostics: [diagnostic('RESISTANCE_SHORT', [aNet, bNet], 'info')] };
  const resistors = elements.filter(e => (e.type === 'resistor' || e.type === 'resistive-load') && e.value > 0).map(e => ({ ...e, a: root(e.a), b: root(e.b) })).filter(e => e.a !== e.b);
  const reachable = new Set([a]);
  let changed = true;
  while (changed) { changed = false; for (const e of resistors) if (reachable.has(e.a) !== reachable.has(e.b)) { reachable.add(e.a); reachable.add(e.b); changed = true; } }
  if (!reachable.has(b)) return { status: 'open', diagnostics: [diagnostic('RESISTANCE_OPEN', [aNet, bNet], 'info')] };
  let testId = '__resistance_test'; while (circuit.elements.some(e => e.id === testId)) testId += '_';
  const result = solveCircuit({
    nets: [...reachable].sort().map(id => ({ id, endpointIds: [], wireIds: [] })),
    endpointToNet: {}, referenceNetId: b,
    elements: [...resistors.filter(e => reachable.has(e.a)), { id: testId, type: 'dc-voltage-source', a, b, value: 1, closed: true }],
  });
  const current = -result.branchCurrents[testId], ohms = 1 / current;
  if (result.status === 'error' || !Number.isFinite(ohms) || ohms <= 0) return { status: 'error', diagnostics: result.diagnostics.length ? result.diagnostics : [diagnostic('ILL_CONDITIONED_SYSTEM', [aNet, bNet])] };
  return { status: 'finite', ohms, diagnostics: [] };
}

export interface ConservationResult { defined: boolean; terms: { elementId: string; value: number }[]; sum?: number; tolerance: number; passes: boolean; diagnostics: Diagnostic[] }
const unavailable = (code: string, ids: string[] = []): ConservationResult => ({ defined: false, terms: [], tolerance: 1e-9, passes: false, diagnostics: [diagnostic(code, ids)] });
function total(terms: ConservationResult['terms']): ConservationResult {
  if (terms.some(t => !Number.isFinite(t.value))) return unavailable('MEASUREMENT_UNAVAILABLE');
  const sum = terms.reduce((a, t) => a + t.value, 0), tolerance = 1e-9 + 1e-9 * terms.reduce((a, t) => a + Math.abs(t.value), 0);
  return { defined: true, terms, sum, tolerance, passes: Math.abs(sum) <= tolerance, diagnostics: Math.abs(sum) <= tolerance ? [] : [diagnostic('CONSERVATION_RESIDUAL', terms.map(t => t.elementId))] };
}
/** Positive contributions leave the selected net; negative contributions enter it. */
export function checkKcl(circuit: CompiledCircuit, result: SimulationResult, netId: string): ConservationResult {
  if (!circuit.nets.some(n => n.id === netId)) return unavailable('INVALID_REFERENCE', [netId]);
  if (result.status === 'error' || !Number.isFinite(result.nodeVoltages[netId])) return unavailable('MEASUREMENT_UNAVAILABLE', [netId]);
  return total(circuit.elements.filter(e => e.a === netId || e.b === netId).map(e => ({ elementId: e.id, value: result.branchCurrents[e.id] * ((e.a === netId ? 1 : 0) - (e.b === netId ? 1 : 0)) })));
}
/** A directed, continuous closed path. Element voltages use the solver's a→b convention. */
export function checkKvl(circuit: CompiledCircuit, result: SimulationResult, steps: { elementId: string; from: string; to: string }[]): ConservationResult {
  if (!steps.length || steps.some((s, i) => s.to !== steps[(i + 1) % steps.length].from)) return unavailable('PATH_NOT_CLOSED', steps.map(s => s.elementId));
  if (result.status === 'error') return unavailable('MEASUREMENT_UNAVAILABLE');
  const terms: ConservationResult['terms'] = [];
  for (const step of steps) {
    const e = circuit.elements.find(e => e.id === step.elementId);
    if (!e || !((step.from === e.a && step.to === e.b) || (step.from === e.b && step.to === e.a))) return unavailable('INVALID_PATH', [step.elementId]);
    if ((e.type === 'switch' && !e.closed) || e.type === 'voltmeter') return unavailable('PATH_NOT_CLOSED', [step.elementId]);
    terms.push({ elementId: e.id, value: result.componentVoltages[e.id] * (step.from === e.a ? -1 : 1) });
  }
  return total(terms);
}
