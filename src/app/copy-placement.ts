import {
  emptyDocument,
  isChangeoverSwitch,
  type CircuitDocument,
  type ComponentInstance,
  type Point,
} from '../domain';
import { terminalPosition, wirePoints, type ComponentKind } from '../component-library';
import type { PastePayload } from '../editor';
import { snapGridPoint } from '../wire-geometry';

export function payloadDocument(payload: PastePayload): CircuitDocument {
  return { ...emptyDocument('copy-preview'), ...payload };
}
export function singleCopiedComponent(payload: PastePayload | null | undefined) {
  return payload?.components.length === 1 && !payload.wires.length && !payload.junctions.length
    ? payload.components[0]
    : undefined;
}
export function copiedComponentKind(component: ComponentInstance): ComponentKind {
  return isChangeoverSwitch(component) ? 'changeover-switch' : component.type;
}
export function copyAt(payload: PastePayload, point: Point): PastePayload {
  const doc = payloadDocument(payload),
    single = singleCopiedComponent(payload);
  const points = [
    ...payload.components.map((c) => c.position),
    ...payload.junctions.map((j) => j.position),
    ...payload.wires.flatMap((w) => wirePoints(doc, w)),
  ];
  const center =
    single?.position ??
    snapGridPoint({
      x: (Math.min(...points.map((p) => p.x)) + Math.max(...points.map((p) => p.x))) / 2,
      y: (Math.min(...points.map((p) => p.y)) + Math.max(...points.map((p) => p.y))) / 2,
    });
  const target = point;
  const shift = (p: Point) => ({ x: p.x + target.x - center.x, y: p.y + target.y - center.y });
  return {
    components: payload.components.map((c) => ({ ...c, position: shift(c.position) })),
    junctions: payload.junctions.map((j) => ({ ...j, position: shift(j.position) })),
    wires: payload.wires.map((w) => ({ ...w, waypoints: w.waypoints.map(shift) })),
    annotations: payload.annotations.map((a) => ({
      ...a,
      ...(a.position ? { position: shift(a.position) } : {}),
      ...(a.end ? { end: shift(a.end) } : {}),
    })),
  };
}

function componentBox(c: ComponentInstance) {
  const points = c.terminals.map((_, i) => terminalPosition(c, i));
  return {
    left: Math.min(c.position.x - 24, ...points.map((p) => p.x)),
    right: Math.max(c.position.x + 24, ...points.map((p) => p.x)),
    top: Math.min(c.position.y - 24, ...points.map((p) => p.y)),
    bottom: Math.max(c.position.y + 24, ...points.map((p) => p.y)),
  };
}
/** A copied group never inserts itself or joins anything already on the canvas. */
export function copyOverlapsComponents(document: CircuitDocument, payload: PastePayload): boolean {
  const copied = payloadDocument(payload),
    boxes = payload.components.map(componentBox);
  return document.components.some((c) => {
    const b = componentBox(c);
    const contains = (p: Point) =>
      p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom;
    return (
      boxes.some(
        (a) => a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top,
      ) ||
      payload.junctions.some((j) => contains(j.position)) ||
      payload.wires.some((w) =>
        wirePoints(copied, w).some((p, i, points) => {
          if (!i) return contains(p);
          const a = points[i - 1];
          return (
            Math.min(a.x, p.x) <= b.right &&
            Math.max(a.x, p.x) >= b.left &&
            Math.min(a.y, p.y) <= b.bottom &&
            Math.max(a.y, p.y) >= b.top
          );
        }),
      )
    );
  });
}

export function elementsInSelection(document: CircuitDocument, start: Point, end: Point): string[] {
  const inside = (p: Point) =>
    p.x >= Math.min(start.x, end.x) &&
    p.x <= Math.max(start.x, end.x) &&
    p.y >= Math.min(start.y, end.y) &&
    p.y <= Math.max(start.y, end.y);
  return [
    ...document.components.filter((c) => inside(c.position)).map((c) => c.id),
    ...document.junctions.filter((j) => inside(j.position)).map((j) => j.id),
    ...document.wires.filter((w) => wirePoints(document, w).every(inside)).map((w) => w.id),
  ];
}
