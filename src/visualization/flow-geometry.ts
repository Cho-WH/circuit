import * as q from '../rational';
import type { Point } from '../domain';

/** Speed stays constant; the reference spacing is divided by relative current. */
export const flowSpeed = 30;
export const flowSpacing = 34;
export const flowJunctionRadius = 3.5;
const junctionFadeLength = 8;
/** Only opacity changes near an electrical junction; train phase and speed do not. */
export function flowJunctionOpacity(
  distance: number,
  length: number,
  fadeStart: boolean,
  fadeEnd: boolean,
): number {
  const fade = (d: number) => {
    const t = Math.max(0, Math.min(1, (d - flowJunctionRadius) / junctionFadeLength));
    return t * t * (3 - 2 * t);
  };
  return Math.min(fadeStart ? fade(distance) : 1, fadeEnd ? fade(length - distance) : 1);
}
export function currentSpacing(amperes: q.Scalar, scaleAmperes: q.Scalar): number {
  return q.sign(amperes) === 0 || q.sign(scaleAmperes) <= 0 ? Infinity : flowSpacing / q.toNumber(q.div(q.abs(amperes), scaleAmperes));
}
export function flowLength(points: readonly Point[]): number {
  return points
    .slice(1)
    .reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);
}
export interface FlowViewport {
  width: number;
  height: number;
}
export interface FlowMark extends Point {
  angle: number;
  segment: number;
  t: number;
}

function visibleInterval(
  a: Point,
  dx: number,
  dy: number,
  viewport: FlowViewport,
): [number, number] | null {
  let start = 0,
    end = 1;
  for (const [p, q] of [
    [-dx, a.x + 8],
    [dx, viewport.width + 8 - a.x],
    [-dy, a.y + 8],
    [dy, viewport.height + 8 - a.y],
  ]) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) start = Math.max(start, t);
    else end = Math.min(end, t);
    if (start > end) return null;
  }
  return [start, end];
}
/** Arc length is measured AFTER projection, including slopes and wire bridges.
 * Clipping limits work to the visible window without changing speed or phase.
 * Marks have no identity/charge; this is a directional texture, not particle transport.
 */
export function flowMarks(
  points: readonly Point[],
  phasePixels: number,
  viewport: FlowViewport,
  spacing = flowSpacing,
  projected = points,
): FlowMark[] {
  const marks: FlowMark[] = [];
  if (!Number.isFinite(spacing) || spacing <= 0) return marks;
  const phase = ((phasePixels % spacing) + spacing) % spacing;
  let travelled = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      dx = b.x - a.x,
      dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length === 0) continue;
    const screenA = projected[i - 1],
      screenB = projected[i];
    if (!screenA || !screenB) continue;
    const screenDx = screenB.x - screenA.x,
      screenDy = screenB.y - screenA.y;
    const interval = visibleInterval(screenA, screenDx, screenDy, viewport);
    if (interval) {
      const start = travelled + interval[0] * length,
        end = travelled + interval[1] * length;
      for (
        let distance = phase + Math.ceil((start - phase) / spacing) * spacing;
        distance < end && marks.length < 600;
        distance += spacing
      ) {
        const t = (distance - travelled) / length;
        marks.push({
          x: screenA.x + t * screenDx,
          y: screenA.y + t * screenDy,
          angle: (Math.atan2(screenDy, screenDx) * 180) / Math.PI,
          segment: i - 1,
          t,
        });
      }
    }
    travelled += length;
  }
  return marks;
}
