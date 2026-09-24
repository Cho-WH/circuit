import { createDocumentIdAllocator, type CircuitDocument, type EndpointRef, type Point } from '../../domain';
import { endpointPosition, terminalPosition, wirePoints, wireCrossings, type WireCrossing } from '../../component-library';
import { previewCommand, type Command } from '../../editor';

export type EndpointTarget = { kind: 'endpoint'; ref: EndpointRef; point: Point };
export type WireTarget = { kind: 'wire'; wireId: string; point: Point };
export type CrossingTarget = { kind: 'crossing'; crossing: WireCrossing; point: Point };
export type WiringTarget = EndpointTarget | WireTarget | CrossingTarget;
export type WireAnchor = EndpointTarget | WireTarget;
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const targetKey = (t: WiringTarget) => t.kind === 'endpoint' ? t.ref.id : t.kind === 'wire' ? `${t.wireId}:${t.point.x}:${t.point.y}` : `cross:${t.point.x}:${t.point.y}`;

/** A short perpendicular branch on the pointer's side, sized in screen pixels. */
export function branchHintEnd(doc: CircuitDocument, target: WireTarget, pointer: Point, scale: number): Point {
  const wire = doc.wires.find(w => w.id === target.wireId);
  const points = wire ? wirePoints(doc, wire) : [];
  const vertical = points.slice(1).some((b, i) => points[i].x === b.x && target.point.x === b.x && target.point.y >= Math.min(points[i].y,b.y) && target.point.y <= Math.max(points[i].y,b.y));
  const length = 34 / scale;
  return vertical ? { x: target.point.x + (pointer.x < target.point.x ? -length : length), y: target.point.y }
    : { x: target.point.x, y: target.point.y + (pointer.y > target.point.y ? length : -length) };
}

/** Geometry only chooses an explicit command target; it never changes electrical connectivity. */
export function wiringTargets(doc: CircuitDocument, p: Point, scale: number, drawing: boolean): WiringTarget[] {
  const endpoints: EndpointTarget[] = [
    ...doc.components.flatMap(c => c.terminals.map((t, i): EndpointTarget => ({ kind: 'endpoint', ref: { kind: 'terminal', id: t.id }, point: terminalPosition(c, i) }))),
    ...doc.junctions.map((j): EndpointTarget => ({ kind: 'endpoint', ref: { kind: 'junction', id: j.id }, point: j.position })),
  ];
  const nearby = endpoints.filter(t => distance(t.point, p) * scale <= 22).sort((a, b) => distance(a.point, p) - distance(b.point, p));
  // At a zoomed-out scale the terminal hit areas can overlap the whole body.
  // Keep the body center selectable; an exact terminal still wins by distance.
  const nearestEndpoint = nearby.length ? distance(nearby[0].point, p) * scale : Infinity;
  if (!drawing && doc.components.some(c => distance(c.position, p) * scale < Math.min(12, nearestEndpoint))) return [];
  if (nearby.length) return nearby;
  if (!drawing) {
    const crossing = wireCrossings(doc).filter(c => distance(c.point, p) * scale <= 22).sort((a, b) => distance(a.point, p) - distance(b.point, p))[0];
    if (crossing) return [{ kind: 'crossing', crossing, point: crossing.point }];
  }
  return doc.wires.flatMap(w => {
    const points = wirePoints(doc, w);
    const candidates = points.slice(1).flatMap((b, i) => {
      const a = points[i], vertical = a.x === b.x;
      if (!vertical && a.y !== b.y) return [];
      const low = Math.min(vertical ? a.y : a.x, vertical ? b.y : b.x), high = Math.max(vertical ? a.y : a.x, vertical ? b.y : b.x);
      const axis = vertical ? p.y : p.x, clamped = Math.max(low, Math.min(high, axis));
      const projected = vertical ? { x: a.x, y: clamped } : { x: clamped, y: a.y };
      if (distance(projected, p) * scale > 16 || high - low <= 2) return [];
      const snapped = Math.max(low + 1, Math.min(high - 1, Math.round(clamped / 20) * 20));
      return [{ point: vertical ? { x: a.x, y: snapped } : { x: snapped, y: a.y }, d: distance(projected, p) }];
    }).sort((a, b) => a.d - b.d);
    return candidates.length ? [{ kind: 'wire' as const, wireId: w.id, point: candidates[0].point, d: candidates[0].d }] : [];
  }).sort((a, b) => a.d - b.d);
}

/** The provisional start junction and both ends are committed in one editor transaction. */
export function connectionCommands(doc: CircuitDocument, start: WireAnchor, end: WireAnchor, waypoints: Point[] = []): Command[] {
  if (targetKey(start) === targetKey(end) || distance(start.point, end.point) < 1) return [];
  const nextId = createDocumentIdAllocator(doc), commands: Command[] = [];
  let source: EndpointRef;
  let splitId: string | undefined;
  if (start.kind === 'endpoint') source = start.ref;
  else {
    source = { kind: 'junction', id: nextId('J') }; splitId = nextId('W');
    commands.push({ type: 'AddJunction', junction: { id: source.id, position: start.point }, wireId: start.wireId, newWireId: splitId });
  }
  if (end.kind === 'endpoint') commands.push({ type: 'ConnectWire', wire: { id: nextId('W'), start: source, end: end.ref, waypoints } });
  else {
    let wireId = end.wireId;
    // A second point on the same wire can lie in either half after the provisional split.
    if (start.kind === 'wire' && start.wireId === end.wireId) {
      const preview = previewCommand(doc, commands[0]);
      if (preview.ok) {
        const match = preview.document.wires.filter(w => w.id === wireId || w.id === splitId).find(w => {
          const points = wirePoints(preview.document, w);
          return points.slice(1).some((b, i) => { const a = points[i]; return a.x === b.x ? end.point.x === a.x && end.point.y > Math.min(a.y, b.y) && end.point.y < Math.max(a.y, b.y) : end.point.y === a.y && end.point.x > Math.min(a.x, b.x) && end.point.x < Math.max(a.x, b.x); });
        });
        if (match) wireId = match.id;
      }
    }
    commands.push({ type: 'ConnectToWire', start: source, wireId, point: end.point, junctionId: nextId('J'), newWireId: nextId('W'), branchId: nextId('W'), waypoints });
  }
  return commands;
}

export function crossingCommand(doc: CircuitDocument, target: CrossingTarget | EndpointTarget): Command | null {
  if (target.kind === 'endpoint') return target.ref.kind === 'junction' ? { type: 'DisconnectCrossing', junctionId: target.ref.id } : null;
  const nextId = createDocumentIdAllocator(doc);
  return { type: 'ConnectCrossing', point: target.point, wireIds: [target.crossing.horizontalId, target.crossing.verticalId], junctionId: nextId('J'), newWireIds: [nextId('W'), nextId('W')] };
}

export function endpointTarget(doc: CircuitDocument, ref: EndpointRef): EndpointTarget { return { kind: 'endpoint', ref, point: endpointPosition(doc, ref) }; }
