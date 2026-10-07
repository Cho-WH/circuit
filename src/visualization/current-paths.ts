import type { CircuitDocument, ComponentInstance, ComponentType, EndpointRef } from '../domain';
import { switchClosed, isChangeoverSwitch, switchTerminals } from '../domain';
import { endpointPosition, wireDisplayPoints, wireCrossings, switchContactPath } from '../component-library';
import type { PotentialModel } from './index';
import type { CurrentModel, CurrentSample } from './current';

export interface CurrentPoint {
  x: number;
  y: number;
  z: number;
}
export interface CurrentPath {
  id: string;
  sample: CurrentSample;
  color?: string;
  points: CurrentPoint[];
}
// Explicit support is deliberate: a future capacitor/diode must choose its own
// presentation policy rather than automatically inheriting a conducting bridge.
const policies: Record<ComponentType, (component: ComponentInstance) => boolean> = {
  resistor: () => true,
  diode: () => true,
  'resistive-load': () => true,
  'dc-voltage-source': () => true,
  ammeter: () => true,
  switch: switchClosed,
  voltmeter: () => false,
};
export function hasCurrentBridge(component: ComponentInstance): boolean {
  return policies[component.type]?.(component) ?? false;
}
/** Geometry follows IDs and explicit device policy; it never determines current. */
export function buildCurrentPaths(
  document: CircuitDocument,
  model: CurrentModel,
  potential?: PotentialModel,
  colors?: Record<string, string>,
): CurrentPath[] {
  const samples = new Map(model.samples.map((sample) => [sample.id, sample]));
  const paths: CurrentPath[] = [];
  const crossings = potential ? [] : wireCrossings(document);
  const lift = (ref: EndpointRef) => (potential ? potential.endpoints[ref.id]?.height : 0);
  for (const wire of document.wires) {
    const sample = samples.get(wire.id),
      z = lift(wire.start);
    if (!sample || z === undefined) continue;
    paths.push({
      id: wire.id,
      sample,
      color: colors?.[wire.start.id],
      points: wireDisplayPoints(document, wire, crossings).map((p) => ({ ...p, z })),
    });
  }
  for (const component of document.components) {
    const sample = samples.get(component.id);
    if (!sample || !hasCurrentBridge(component)) continue;
    const first =
      component.type === 'dc-voltage-source'
        ? (component.terminals.find((t) => t.role === 'positive') ?? component.terminals[0])
        : component.terminals[0];
    const last = isChangeoverSwitch(component) ? switchTerminals(component)[1] : component.terminals.find((t) => t.id !== first?.id);
    if (!first || !last) continue;
    const refs: EndpointRef[] =
      sample.value.status === 'known'
        ? [sample.value.from, sample.value.to]
        : [
            { kind: 'terminal', id: isChangeoverSwitch(component) ? switchTerminals(component)[0]!.id : first.id },
            { kind: 'terminal', id: last.id },
          ];
    const heights = refs.map(lift);
    if (heights.some((z) => z === undefined)) continue;
    paths.push({
      id: component.id,
      sample,
      points: isChangeoverSwitch(component) ? switchContactPath(component).map(p => ({ ...p, z: heights[0]! })) : refs.map((ref, i) => ({ ...endpointPosition(document, ref), z: heights[i]! })),
    });
  }
  return paths;
}
