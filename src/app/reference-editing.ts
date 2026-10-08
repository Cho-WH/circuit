import type { CircuitDocument, Point } from '../domain';
import { createDocumentIdAllocator } from '../domain';
import { type Command } from '../editor';
import { wiringTargets, type WireAnchor } from './wiring';

export function referenceTargets(document: CircuitDocument, point: Point, scale: number): WireAnchor[] {
  // Crossings offer the individual wires; they must never be joined by placing a reference.
  return wiringTargets(document, point, scale, true).filter((t): t is WireAnchor => t.kind !== 'crossing');
}

export function referenceCommands(document: CircuitDocument, target: WireAnchor): Command[] {
  if (target.kind === 'endpoint') return document.referenceNode?.id === target.ref.id ? [] : [{ type: 'SetReference', endpoint: target.ref }];
  const nextId = createDocumentIdAllocator(document), id = nextId('J');
  return [
    { type: 'AddJunction', junction: { id, position: target.point }, wireId: target.wireId, newWireId: nextId('W') },
    { type: 'SetReference', endpoint: { kind: 'junction', id } },
  ];
}
