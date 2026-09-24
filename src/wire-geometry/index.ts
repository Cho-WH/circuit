import type { Point } from '../domain';

export type WirePosture = 'HV' | 'VH';
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;

/** Remove duplicate / forward-collinear vertices, never a deliberate reversal. */
export function compactWirePoints(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const p of points) {
    if (result.length && same(result.at(-1)!, p)) continue;
    while (result.length >= 2) {
      const a = result.at(-2)!, b = result.at(-1)!;
      if ((a.x === b.x && b.x === p.x && (b.y-a.y)*(p.y-b.y)>=0) || (a.y === b.y && b.y === p.y && (b.x-a.x)*(p.x-b.x)>=0)) result.pop();
      else break;
    }
    result.push(p);
  }
  return result;
}

/** One unfinished leg, with an explicit posture; no obstacle search or topology changes. */
export function orthogonalRoute(start: Point, end: Point, posture: WirePosture): Point[] {
  return compactWirePoints([start, posture === 'HV' ? { x: end.x, y: start.y } : { x: start.x, y: end.y }, end]);
}

/** Legacy documents may contain diagonal legs. Rectify only paths being edited. */
export function orthogonalWirePoints(points: Point[]): Point[] {
  return compactWirePoints(points.flatMap((p, i) => i ? orthogonalRoute(points[i - 1], p, 'VH').slice(1) : [p]));
}

/** Preserve the middle of a polyline; only the nearest corner at each end can change. */
export function stretchWire(points: Point[], start: Point, end: Point): Point[] {
  const original = orthogonalWirePoints(points);
  if (original.length < 2) return orthogonalRoute(start, end, 'VH');
  const a = original[0], b = original.at(-1)!;
  if (same(a, start) && same(b, end)) return original;
  const dx = start.x - a.x, dy = start.y - a.y;
  if (end.x - b.x === dx && end.y - b.y === dy) {
    return original.map(p => ({ x: p.x + dx, y: p.y + dy }));
  }
  const horizontal = a.y === original[1].y;
  if (original.length === 2) {
    if (start.x === end.x || start.y === end.y) return [start, end];
    const middle = horizontal ? (start.x + end.x) / 2 : (start.y + end.y) / 2;
    return horizontal
      ? [start, { x: middle, y: start.y }, { x: middle, y: end.y }, end]
      : [start, { x: start.x, y: middle }, { x: end.x, y: middle }, end];
  }
  const result = original.map(p => ({ ...p }));
  result[0] = { ...start }; result[result.length - 1] = { ...end };
  if (horizontal) result[1].y = start.y; else result[1].x = start.x;
  const last = result.length - 2;
  if (original[last].y === b.y) result[last].y = end.y; else result[last].x = end.x;
  return compactWirePoints(result);
}

/** Offset one segment perpendicular to itself. The two electrical endpoints stay fixed. */
export function shiftWireSegment(points: Point[], segment: number, offset: number): Point[] | null {
  const path = orthogonalWirePoints(points);
  if (!Number.isInteger(segment) || segment < 0 || segment >= path.length - 1 || !Number.isFinite(offset)) return null;
  if (!offset) return path;
  const a = path[segment], b = path[segment + 1];
  const horizontal = a.y === b.y;
  const shift = (p: Point) => horizontal ? { x: p.x, y: p.y + offset } : { x: p.x + offset, y: p.y };
  return compactWirePoints([
    ...path.slice(0, segment),
    ...(segment === 0 ? [a] : []), shift(a), shift(b),
    ...(segment === path.length - 2 ? [b] : []),
    ...path.slice(segment + 2),
  ]);
}
