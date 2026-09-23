import type { CircuitDocument } from '../domain';
import { documentBounds, endpointPosition, terminalPosition } from '../component-library';
import type { PotentialModel } from '../visualization';

/** Pleasant, signed voltage ticks; the zero plane is always included. */
export function voltageTicks(values: number[]): number[] {
  const finite = values.filter(Number.isFinite);
  const min = Math.min(0, ...finite), max = Math.max(0, ...finite);
  if (min === max) return [0];
  const raw = (max - min) / 3;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find(n => n * power >= raw)! * power;
  const first = Math.floor(min / step), last = Math.ceil(max / step);
  return Array.from({ length: last - first + 1 }, (_, i) => Number(((first + i) * step).toPrecision(12)));
}

export function sceneAnchors(document: CircuitDocument, potential: PotentialModel) {
  return Object.values(potential.nets).flatMap(net => {
    if (net.height === undefined || net.voltage === undefined) return [];
    const junction = document.junctions.find(j => net.endpointIds.includes(j.id));
    const component = document.components.find(c => c.terminals.some(t => net.endpointIds.includes(t.id)));
    const terminal = component?.terminals.find(t => net.endpointIds.includes(t.id));
    const point = junction?.position ?? (component && terminal ? terminalPosition(component, component.terminals.indexOf(terminal)) : undefined);
    return point ? [{ ...point, z: net.height, voltage: net.voltage, id: net.netId, color: net.color }] : [];
  });
}

export function sceneExtent(document: CircuitDocument, potential: PotentialModel) {
  const floor = documentBounds(document, 65);
  const ticks = voltageTicks(Object.values(potential.nets).flatMap(n => n.voltage === undefined ? [] : [n.voltage - potential.referenceVoltage]));
  return { floor, ticks, minZ: Math.min(0, ...ticks) * potential.scale, maxZ: Math.max(0, ...ticks) * potential.scale };
}

export function selectedVoltage(document: CircuitDocument, potential: PotentialModel, id?: string) {
  const component = document.components.find(c => c.id === id);
  if (!component || component.terminals.length < 2) return null;
  const ends = component.terminals.slice(0, 2).map(t => {
    const net = potential.endpoints[t.id];
    return net?.voltage === undefined || net.height === undefined ? null : {
      ...endpointPosition(document, { kind: 'terminal', id: t.id }), z: net.height, voltage: net.voltage,
    };
  });
  if (!ends[0] || !ends[1]) return null;
  return { component, a: ends[0], b: ends[1], difference: ends[0].voltage - ends[1].voltage };
}
