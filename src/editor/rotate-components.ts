import { createDocumentIdAllocator, type CircuitDocument, type EndpointRef, type Point } from '../domain';
import { terminalPosition } from '../component-library';
import { remapEndpointReferences } from './endpoint-references';

const positionKey = (point: Point) => `${point.x},${point.y}`;

/** Rotation leaves wiring in place. Persisted junctions allow reconnection after reload, too. */
export function rotateComponents(document: CircuitDocument, ids: Set<string>): void {
  const allocate = createDocumentIdAllocator(document);
  const referenced = new Set([
    ...document.wires.flatMap(w => [w.start.id, w.end.id]),
    ...document.annotations.flatMap(a => a.anchor ? [a.anchor.id] : []),
    ...(document.referenceNode ? [document.referenceNode.id] : []),
  ]);
  const replacements = new Map<string, EndpointRef>();
  for (const component of document.components.filter(c => ids.has(c.id))) {
    component.terminals.forEach((terminal, index) => {
      if (!referenced.has(terminal.id)) return;
      const junction = { id: allocate('J'), position: terminalPosition(component, index) };
      document.junctions.push(junction);
      replacements.set(terminal.id, { kind: 'junction', id: junction.id });
    });
    component.rotation = ((component.rotation + 90) % 360) as typeof component.rotation;
  }
  const remap = (ref: EndpointRef | null) => ref ? replacements.get(ref.id) ?? ref : null;
  remapEndpointReferences(document, remap);
  replacements.clear();

  // Match the final layout as a whole, not selection order. Never guess between coincident endpoints.
  const terminals = new Map<string, { id: string; selected: boolean }[]>();
  for (const component of document.components) component.terminals.forEach((terminal, index) => {
    const key = positionKey(terminalPosition(component, index));
    terminals.set(key, [...terminals.get(key) ?? [], { id: terminal.id, selected: ids.has(component.id) }]);
  });
  const junctions = new Map<string, string[]>();
  for (const junction of document.junctions) {
    const key = positionKey(junction.position);
    junctions.set(key, [...junctions.get(key) ?? [], junction.id]);
  }
  for (const [key, candidates] of terminals) {
    const ends = junctions.get(key);
    if (candidates.length !== 1 || !candidates[0].selected || ends?.length !== 1) continue;
    replacements.set(ends[0], { kind: 'terminal', id: candidates[0].id });
  }
  remapEndpointReferences(document, remap);
  document.junctions = document.junctions.filter(j => !replacements.has(j.id));
}
