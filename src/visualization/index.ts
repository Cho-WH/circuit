import type { CompiledCircuit, SimulationResult } from '../domain';
export { buildCurrentModel, currentBand, currentFullWidth, type CurrentModel, type CurrentSample, type CurrentValue, type CurrentDisplay } from './current';
export { buildCurrentPaths, hasCurrentBridge, type CurrentPath, type CurrentPoint } from './current-paths';
export { flowMarks, flowSpeed, flowSpacing, flowLength, currentSpacing, flowJunctionOpacity, flowJunctionRadius, type FlowMark, type FlowViewport } from './flow-geometry';
export { buildCurrentTracks, type CurrentTrack, type ProjectedCurrentPath } from './current-tracks';
export { defaultPotentialPalette, potentialPalettes, potentialPalette, potentialColorStops, potentialColor, potentialGradient, type PotentialPaletteId } from './palettes';

export { buildPotentialModel, potentialAxisValue, potentialAxisCoordinate, type PotentialValue, type PotentialSegment, type PotentialRange, type PotentialOptions, type PotentialModel } from './potential';

export interface PathStep { elementId: string; from: string; to: string }
export interface CircuitPath { id: string; label: string; steps: PathStep[] }
export function suggestPaths(circuit: CompiledCircuit): CircuitPath[] {
  const paths: CircuitPath[] = [];
  let visits = 0;
  const elements = circuit.elements.filter(e => e.type !== 'voltmeter');
  for (const source of elements.filter(e => e.type === 'dc-voltage-source')) {
    function visit(node: string, visited: Set<string>, steps: PathStep[]) {
      if (paths.length >= 12 || ++visits > 5000 || steps.length > 40) return;
      if (node === source.b) { const all = [{ elementId: source.id, from: source.b, to: source.a }, ...steps]; paths.push({ id: all.map(s => s.elementId).join(':'), label: all.map(s => s.elementId).join(' → '), steps: all }); return; }
      for (const e of elements) {
        if (e.id === source.id || (e.a !== node && e.b !== node)) continue;
        const to = e.a === node ? e.b : e.a; if (visited.has(to)) continue;
        visit(to, new Set([...visited, to]), [...steps, { elementId: e.id, from: node, to }]);
      }
    }
    visit(source.a, new Set([source.a]), []);
  }
  return paths;
}
export function makePath(circuit: CompiledCircuit, ids: string[]): CircuitPath | null {
  if (!ids.length) return null;
  const first = circuit.elements.find(e => e.id === ids[0]); if (!first) return null;
  for (const start of first.type === 'dc-voltage-source' ? [first.b, first.a] : [first.a, first.b]) {
    let current = start; const steps: PathStep[] = [];
    for (const id of ids) {
      const e = circuit.elements.find(item => item.id === id);
      if (!e || (e.a !== current && e.b !== current)) break;
      const to = e.a === current ? e.b : e.a; steps.push({ elementId: id, from: current, to }); current = to;
    }
    if (steps.length === ids.length) return { id: 'custom', label: '직접 선택한 경로', steps };
  }
  return null;
}
export function pathVoltages(path: CircuitPath, result: SimulationResult) {
  return path.steps.map(step => ({ ...step, fromVoltage: result.nodeVoltages[step.from], toVoltage: result.nodeVoltages[step.to] }));
}
