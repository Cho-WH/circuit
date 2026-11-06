import { diagnostic, type CircuitObservation, type RcFrame, type RcObservation } from '../domain';
import { rcEngine } from './rc/engine';
import { queryVoltage, queryCurrent } from './piecewise';

/** A view over one engine-owned frame. No DC provenance or invented RC power. */
export function observeRcFrame(frame: RcFrame): RcObservation {
  const check = rcEngine.queryCurrent(frame, []);
  if (check.status === 'error') return {
    rcFrame: frame, status: 'error', nodeVoltages: {}, componentVoltages: {},
    branchCurrents: {}, componentPowers: {}, referenceGroups: [], diagnostics: check.diagnostics,
  };
  return {
    rcFrame: frame,
    status: 'solved',
    nodeVoltages: frame.nodeVoltages, componentVoltages: frame.componentVoltages,
    branchCurrents: frame.branchCurrents, componentPowers: {}, referenceGroups: frame.referenceGroups,
    diagnostics: [],
  };
}
export const observationVoltage = (result: CircuitObservation, a: string, b: string) =>
  'rcFrame' in result ? rcEngine.queryVoltage(result.rcFrame, a, b) : queryVoltage(result, a, b);
export const observationCurrent = (result: CircuitObservation, terms: readonly { componentId: string; coefficient: number }[]) =>
  'rcFrame' in result ? rcEngine.queryCurrent(result.rcFrame, terms) : queryCurrent(result, [...terms]);
export function observationWireCurrent(result: CircuitObservation, wireId: string) {
  return 'rcFrame' in result ? rcEngine.queryWireCurrent(result.rcFrame, wireId)
    : { status: 'error' as const, diagnostics: [diagnostic('MEASUREMENT_UNAVAILABLE', [wireId])] };
}
