import type { CircuitDocument, CompiledCircuit, SimulationResult } from '../domain';
import { endpointPosition, wirePoints } from '../component-library';
import { potentialColor, type PotentialPaletteId } from './palettes';
export { defaultPotentialPalette, potentialPalettes, potentialPalette, potentialColorStops, potentialColor, potentialGradient, type PotentialPaletteId } from './palettes';

export interface PotentialValue { netId: string; voltage?: number; color: string; height?: number; endpointIds: string[]; wireIds: string[] }
export interface PotentialSegment { id: string; points: { x: number; y: number; z: number }[]; color: string; kind: 'wire' | 'component' }
export interface PotentialOptions { scale?: number; range?: { min: number; max: number }; palette?: PotentialPaletteId }
export interface PotentialModel { nets: Record<string, PotentialValue>; endpoints: Record<string, PotentialValue>; segments: PotentialSegment[]; min: number; max: number; scale: number; referenceVoltage: number; undefinedCount: number }
export function buildPotentialModel(document: CircuitDocument, circuit: CompiledCircuit, result: SimulationResult, options: PotentialOptions = {}): PotentialModel {
  const values = Object.values(result.nodeVoltages).filter(Number.isFinite);
  const validRange = options.range && Number.isFinite(options.range.min) && Number.isFinite(options.range.max) && options.range.min < options.range.max;
  const min = validRange ? options.range!.min : Math.min(0, ...values), max = validRange ? options.range!.max : Math.max(0, ...values);
  const scale = Number.isFinite(options.scale) && options.scale! > 0 ? options.scale! : 18;
  const referenceVoltage = circuit.referenceNetId ? result.nodeVoltages[circuit.referenceNetId] ?? 0 : 0;
  const nets = Object.fromEntries(circuit.nets.map(net => {
    const v = result.nodeVoltages[net.id]; const voltage = Number.isFinite(v) ? v : undefined;
    return [net.id, { netId: net.id, voltage, color: potentialColor(voltage, min, max, options.palette), height: voltage === undefined ? undefined : scale * (voltage - referenceVoltage), endpointIds: net.endpointIds, wireIds: net.wireIds }];
  })) as Record<string, PotentialValue>;
  const endpoints = Object.fromEntries(Object.entries(circuit.endpointToNet).map(([id, net]) => [id, nets[net]]));
  const segments: PotentialSegment[] = [];
  for (const wire of document.wires) {
    const net = endpoints[wire.start.id]; if (net?.height === undefined) continue;
    segments.push({ id: wire.id, kind: 'wire', color: net.color, points: wirePoints(document, wire).map(p => ({ ...p, z: net.height! })) });
  }
  for (const c of document.components) {
    if (c.type === 'switch' && c.properties.state === 'open') continue;
    if (c.type === 'voltmeter') continue;
    const points = c.terminals.slice(0, 2).map(t => { const v = endpoints[t.id]; return v?.height === undefined ? null : { ...endpointPosition(document, { kind: 'terminal', id: t.id }), z: v.height }; });
    if (points[0] && points[1]) segments.push({ id: c.id, kind: 'component', color: '#586879', points: [points[0], points[1]] });
  }
  return { nets, endpoints, segments, min, max, scale, referenceVoltage, undefinedCount: Object.values(nets).filter(n => n.voltage === undefined).length };
}
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
