import type { CircuitDocument, Wire } from '../domain';
import { wirePoints } from '../component-library';
import { compactWirePoints } from '../wire-geometry';

const anchoredJunctions = (doc: CircuitDocument) => new Set([
  ...doc.annotations.flatMap(a => a.anchor ? [a.anchor.id] : []),
  ...(doc.referenceNode ? [doc.referenceNode.id] : []),
]);
const attachedWires = (doc: CircuitDocument, id: string) => doc.wires.filter(w => w.start.id === id || w.end.id === id);
const isPair = (wires: Wire[], id: string) => wires.length === 2 && !wires.some(w => w.start.id === id && w.end.id === id);

/** Clean only affected junctions: remove isolated points, contract degree two, preserve ends/branches/anchors. */
export function normalizeWireJunctions(document: CircuitDocument, junctionIds: Iterable<string>): void {
  const anchored = anchoredJunctions(document);
  for (const id of new Set(junctionIds)) {
    if (anchored.has(id)) continue;
    const attached = attachedWires(document, id);
    if (!attached.length) {
      document.junctions = document.junctions.filter(j => j.id !== id);
      continue;
    }
    // A closed loop still needs an endpoint in the document model.
    if (!isPair(attached, id)) continue;
    const [keep, remove] = attached;
    const [incoming, outgoing] = keep.end.id === id ? [keep, remove] : [remove, keep];
    const before = wirePoints(document, incoming), after = wirePoints(document, outgoing);
    if (incoming.start.id === id) before.reverse();
    if (outgoing.end.id === id) after.reverse();
    const path = compactWirePoints([...before, ...after.slice(1)]);
    const start = incoming.start.id === id ? incoming.end : incoming.start;
    const end = outgoing.end.id === id ? outgoing.start : outgoing.end;
    keep.start = start; keep.end = end; keep.waypoints = path.slice(1, -1);
    document.wires = document.wires.filter(w => w !== remove);
    document.junctions = document.junctions.filter(j => j.id !== id);
  }
}

/** Find the continuous route through degree-two points, stopping at branches, anchors and open ends. */
export function normalizeWireRoute(document: CircuitDocument, wireId: string): string | undefined {
  const anchored = anchoredJunctions(document), visited = new Set<string>(), junctions = new Set<string>();
  const pending = document.wires.filter(w => w.id === wireId);
  while (pending.length) {
    const wire = pending.pop()!;
    if (visited.has(wire.id)) continue;
    visited.add(wire.id);
    for (const endpoint of [wire.start, wire.end]) {
      if (endpoint.kind !== 'junction' || anchored.has(endpoint.id)) continue;
      const attached = attachedWires(document, endpoint.id);
      if (isPair(attached, endpoint.id)) { junctions.add(endpoint.id); pending.push(...attached); }
    }
  }
  // Document order matches candidate discovery and is independent of the traversal direction.
  normalizeWireJunctions(document, document.junctions.filter(j => junctions.has(j.id)).map(j => j.id));
  return document.wires.find(w => visited.has(w.id))?.id;
}
