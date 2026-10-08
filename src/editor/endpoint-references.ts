import type { CircuitDocument, EndpointRef } from '../domain';

/** Keep wiring, ground and annotation anchors on the same endpoint replacement. */
export function remapEndpointReferences(
  document: CircuitDocument,
  remap: (ref: EndpointRef | null) => EndpointRef | null,
): void {
  for (const wire of document.wires) {
    wire.start = remap(wire.start)!;
    wire.end = remap(wire.end)!;
  }
  document.annotations = document.annotations.filter(a => !a.anchor || remap(a.anchor));
  for (const annotation of document.annotations) annotation.anchor = remap(annotation.anchor);
  document.referenceNode = remap(document.referenceNode);
}
