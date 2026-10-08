import * as q from '../rational';
import type { CircuitDocument } from '../domain';
import { isChangeoverSwitch, switchTerminals } from '../domain';
import { documentBounds, endpointPosition, terminalPosition } from '../component-library';
import { potentialAxisCoordinate, type PotentialModel, type PotentialRange } from '../visualization';
import { Box3, Matrix4, Vector3 } from 'three';

export const obliqueDirection = new Vector3(.25, -1, .95).normalize();
export function projectedSize(bounds: Box3, view: Matrix4) {
  const projected = new Box3();
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z])
    projected.expandByPoint(new Vector3(x, y, z).applyMatrix4(view));
  return projected.getSize(new Vector3());
}
export function sceneBounds(extent: ReturnType<typeof sceneExtent>) {
  const f = extent.floor;
  return new Box3(new Vector3(f.x-45, -f.y-f.height, extent.minZ-15), new Vector3(f.x+f.width+45, -f.y+25, extent.maxZ+30));
}
/** Default camera basis and framing bounds, using the actual 3D host dimensions. */
export function automaticHeight(document: CircuitDocument, potential: PotentialModel, width: number, height: number) {
  const bounds = sceneBounds(sceneExtent(document, potential));
  bounds.min.z = bounds.max.z = 0;
  const view = new Matrix4().lookAt(obliqueDirection, new Vector3(), new Vector3(0, 0, 1)).invert();
  const span = projectedSize(bounds, view);
  const flatFit = Math.max(span.y, span.x / (Math.max(1, width) / Math.max(1, height)), 100);
  const verticalProjection = new Vector3(0, 0, 1).transformDirection(view).y;
  return Math.min(span.y, flatFit / .75 - span.y) / verticalProjection;
}
function heightTicks(potential: PotentialModel, range?: PotentialRange) {
  return voltageTicks(range
    ? [range.min, range.max].map(value => potentialAxisCoordinate(potential, value))
    : Object.values(potential.nets).flatMap(net => net.voltage === undefined ? [] : [net.voltage - potential.referenceVoltage]));
}
/** Rescale display geometry while preserving voltages, colors and endpoint/net identity. */
export function fitPotentialHeight(potential: PotentialModel, height: number, multiplier: number, range?: PotentialRange): PotentialModel {
  const ticks = heightTicks(potential, range);
  const span = Math.max(...ticks) - Math.min(...ticks);
  const scale = span > 0 ? height / span * multiplier : 1;
  const ratio = scale / potential.scale;
  const nets = Object.fromEntries(Object.entries(potential.nets).map(([id, net]) => [id, { ...net, height: net.height === undefined ? undefined : net.height * ratio }]));
  return { ...potential, scale, nets,
    endpoints: Object.fromEntries(Object.entries(potential.endpoints).map(([id, net]) => [id, nets[net.netId]])),
    segments: potential.segments.map(segment => ({ ...segment, points: segment.points.map(p => ({ ...p, z: p.z * ratio })) })),
  };
}

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

/** Unlabelled subdivisions: 5 V → 1 V, 2 V → 0.5 V, 2.5 V → 0.5 V. */
export function minorVoltageTicks(ticks: number[]): number[] {
  if (ticks.length < 2) return [];
  const step = ticks[1] - ticks[0];
  const leading = Number((step / 10 ** Math.floor(Math.log10(step))).toPrecision(10));
  const divisions = leading === 2 ? 4 : 5;
  return ticks.slice(0, -1).flatMap((start, i) =>
    Array.from({ length: divisions - 1 }, (_, j) =>
      Number((start + (ticks[i + 1] - start) * (j + 1) / divisions).toPrecision(12))));
}

export function sceneAnchors(document: CircuitDocument, potential: PotentialModel) {
  return Object.values(potential.nets).flatMap(net => {
    if (net.height === undefined || net.exactVoltage === undefined) return [];
    const junction = document.junctions.find(j => net.endpointIds.includes(j.id));
    const component = document.components.find(c => c.terminals.some(t => net.endpointIds.includes(t.id)));
    const terminal = component?.terminals.find(t => net.endpointIds.includes(t.id));
    const point = junction?.position ?? (component && terminal ? terminalPosition(component, component.terminals.indexOf(terminal)) : undefined);
    return point ? [{ ...point, z: net.height, voltage: net.exactVoltage, id: net.netId, color: net.color }] : [];
  });
}

export function sceneExtent(document: CircuitDocument, potential: PotentialModel, range?: PotentialRange) {
  const floor = documentBounds(document, 65);
  const ticks = heightTicks(potential, range);
  return { floor, ticks, minZ: Math.min(0, ...ticks) * potential.scale, maxZ: Math.max(0, ...ticks) * potential.scale };
}

export function selectedVoltage(document: CircuitDocument, potential: PotentialModel, id?: string) {
  const component = document.components.find(c => c.id === id);
  if (!component || component.terminals.length < 2) return null;
  const refs = (isChangeoverSwitch(component) ? switchTerminals(component) : component.terminals.slice(0, 2))
    .map(t => t && potential.endpoints[t.id]?.referenceId);
  if (refs[0] && refs[1] && refs[0] !== refs[1]) return null;
  const ends = (isChangeoverSwitch(component) ? switchTerminals(component) : component.terminals.slice(0, 2)).map(t => {
    if (!t) return null;
    const net = potential.endpoints[t.id];
    return net?.exactVoltage === undefined || net.height === undefined ? null : {
      ...endpointPosition(document, { kind: 'terminal', id: t.id }), z: net.height, voltage: net.exactVoltage,
    };
  });
  if (!ends[0] || !ends[1]) return null;
  return { component, a: ends[0], b: ends[1], difference: q.sub(ends[0].voltage,ends[1].voltage) };
}
