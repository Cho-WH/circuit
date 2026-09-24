import { createDocumentIdAllocator, type CircuitDocument, type EndpointRef } from '../domain';
import { terminalPosition } from '../component-library';
import { orthogonalRoute } from '../wire-geometry';
import { dissolveWireJunctions } from './wire-edits';

/** Replace removed terminals locally; never infer a connection from coincident coordinates. */
function replaceConnectedComponents(document: CircuitDocument, ids: Set<string>, allocate: (prefix: string) => string) {
  const attached = new Set(document.wires.flatMap(wire => [wire.start.id, wire.end.id]));
  const replacements = new Map<string, EndpointRef>();
  for (const component of document.components.filter(c => ids.has(c.id))) {
    if (!component.terminals.some(t => attached.has(t.id))) continue;
    const bridge = component.terminals.length === 2;
    component.terminals.forEach((terminal, index) => {
      // Unsupported multi-terminal parts retain individual wire ends without guessing internal wiring.
      if (!bridge && !attached.has(terminal.id)) return;
      const junction = { id: allocate('J'), position: terminalPosition(component, index) };
      document.junctions.push(junction);
      replacements.set(terminal.id, { kind: 'junction', id: junction.id });
    });
    if (bridge) {
      const path = orthogonalRoute(terminalPosition(component, 0), terminalPosition(component, 1), 'VH');
      document.wires.push({
        id: allocate('W'),
        start: replacements.get(component.terminals[0].id)!,
        end: replacements.get(component.terminals[1].id)!,
        waypoints: path.slice(1, -1),
      });
    }
  }
  return replacements;
}

/** One document edit: explicit deletion wins, surviving wiring keeps its route and references. */
export function deleteElements(document: CircuitDocument, ids: Set<string>): void {
  const allocate = createDocumentIdAllocator(document);
  const removedEndpoints = new Set([
    ...document.components.filter(c => ids.has(c.id)).flatMap(c => c.terminals.map(t => t.id)),
    ...document.junctions.filter(j => ids.has(j.id)).map(j => j.id),
  ]);
  // Remove only explicitly selected wires and wires attached to explicitly removed junctions first.
  document.wires = document.wires.filter(w => !ids.has(w.id) && !ids.has(w.start.id) && !ids.has(w.end.id));
  const replacements = replaceConnectedComponents(document, ids, allocate);
  const remap = (ref: EndpointRef | null): EndpointRef | null =>
    ref ? replacements.get(ref.id) ?? (removedEndpoints.has(ref.id) ? null : ref) : null;

  for (const wire of document.wires) {
    wire.start = remap(wire.start)!;
    wire.end = remap(wire.end)!;
  }
  document.components = document.components.filter(c => !ids.has(c.id));
  document.junctions = document.junctions.filter(j => !ids.has(j.id));
  document.annotations = document.annotations.filter(a => !ids.has(a.id) && (!a.anchor || remap(a.anchor)));
  for (const annotation of document.annotations) annotation.anchor = remap(annotation.anchor);
  document.referenceNode = remap(document.referenceNode);
  dissolveWireJunctions(document, [...replacements.values()].map(ref => ref.id));
}
