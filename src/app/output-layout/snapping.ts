import type { Point } from '../../domain';
import type { OutputLayout, OutputLayoutItem, OutputRef } from '../../export';
import {
  intersects,
  normalizeSelection,
  refKey,
  selectionUnits,
  unionBounds,
  type Rect,
} from './geometry';

type Axis = 'x' | 'y';
export type Guide = { kind: 'alignment' | 'gap' | 'body-gap'; start: Point; end: Point };
type BodyGap = {
  axis: Axis;
  before: boolean;
  gap: number;
  host: Rect;
  referenceHost: Rect;
  reference: OutputLayoutItem;
};
type Candidate = {
  key: string;
  axis: Axis;
  delta: number;
  priority: number;
  target: Rect;
  at: number;
  gap?: readonly [number, number][];
  bodyGap?: BodyGap;
};
export type SnapResult = { delta: Point; guides: Guide[]; locks: Partial<Record<Axis, string>> };
export type SnapSession = {
  layout: OutputLayout;
  units: OutputLayoutItem[];
  moving: OutputLayoutItem[];
  fixed: OutputLayoutItem[];
  bounds: Rect;
  scale: Point;
  view: Rect;
  gaps: { axis: Axis; first: OutputLayoutItem; second: OutputLayoutItem }[];
  bodyGaps: BodyGap[];
};
const shift = (b: Rect, p: Point): Rect => ({ ...b, x: b.x + p.x, y: b.y + p.y });
const extent = (axis: Axis) => (axis === 'x' ? 'width' : 'height');
const other = (axis: Axis): Axis => (axis === 'x' ? 'y' : 'x');
const distance = (a: Rect, b: Rect, axis: Axis) =>
  Math.max(0, a[axis] - b[axis] - b[extent(axis)], b[axis] - a[axis] - a[extent(axis)]);
const role = (item: OutputLayoutItem) =>
  item.kind === 'arrow' ? 'arrow' : item.ref.part === 'annotation' ? item.kind : item.ref.part;

const overlap = (a: Rect, b: Rect, axis: Axis) =>
  Math.min(a[axis] + a[extent(axis)], b[axis] + b[extent(axis)]) - Math.max(a[axis], b[axis]);
const bodyDistance = (body: Rect, text: Rect, axis: Axis, before: boolean) =>
  before
    ? body[axis] - text[axis] - text[extent(axis)]
    : text[axis] - body[axis] - body[extent(axis)];

function prepareBodyGaps(
  units: OutputLayoutItem[],
  fixed: OutputLayoutItem[],
  scale: Point,
): BodyGap[] {
  if (units.length !== 1) return [];
  const text = units[0];
  if (
    !text.movable ||
    !['label', 'value'].includes(text.ref.part) ||
    !['text', 'blank'].includes(text.kind)
  )
    return [];
  const symbols = new Map(fixed.filter((i) => i.symbolBody).map((i) => [i.ref.id, i.symbolBody!]));
  const host = symbols.get(text.ref.id);
  if (!host) return [];
  const result: BodyGap[] = [];
  for (const reference of fixed) {
    if (
      !reference.movable ||
      reference.ref.part !== text.ref.part ||
      reference.ref.id === text.ref.id
    )
      continue;
    const body = symbols.get(reference.ref.id);
    if (!body || body.kind !== host.kind || body.rotation % 180 !== host.rotation % 180) continue;
    for (const axis of ['x', 'y'] as const) {
      if (overlap(body.bounds, reference.bounds, other(axis)) <= 0) continue;
      for (const before of [true, false]) {
        const gap = bodyDistance(body.bounds, reference.bounds, axis, before);
        if (gap > 0 && gap * scale[axis] <= 160)
          result.push({
            axis,
            before,
            gap,
            host: host.bounds,
            referenceHost: body.bounds,
            reference,
          });
      }
    }
  }
  return result;
}

function bodyGapGuide(body: Rect, text: Rect, axis: Axis, before: boolean): Guide {
  const perpendicular = other(axis);
  const at =
    (Math.max(body[perpendicular], text[perpendicular]) +
      Math.min(
        body[perpendicular] + body[extent(perpendicular)],
        text[perpendicular] + text[extent(perpendicular)],
      )) /
    2;
  const start = before ? text[axis] + text[extent(axis)] : body[axis] + body[extent(axis)];
  const end = before ? body[axis] : text[axis];
  return {
    kind: 'body-gap',
    start: { x: at, y: at, [axis]: start },
    end: { x: at, y: at, [axis]: end },
  };
}

export function prepareSnap(
  layout: OutputLayout,
  refs: readonly OutputRef[],
  scale: Point,
  view: Rect,
): SnapSession {
  const keys = new Set(normalizeSelection(layout, refs).map(refKey));
  const moving = layout.items.filter(
    (i) => keys.has(refKey(i.ref)) || (i.movesWith && keys.has(refKey(i.movesWith))),
  );
  const movingKeys = new Set(moving.map((i) => refKey(i.ref)));
  const fixed = layout.items.filter(
    (i) => !movingKeys.has(refKey(i.ref)) && intersects(i.symbolBody?.bounds ?? i.bounds, view),
  );
  const units = selectionUnits(layout, refs),
    bounds = unionBounds(units.map((i) => i.bounds));
  const gapUnits = selectionUnits(
    layout,
    fixed.filter((i) => i.movable).map((i) => i.ref),
  );
  const gaps: SnapSession['gaps'] = [];
  // Prepare neighbouring, nonoverlapping pairs once for this gesture.
  for (const axis of ['x', 'y'] as const) {
    const sorted = [...gapUnits].sort(
      (a, b) => a.bounds[axis] - b.bounds[axis] || refKey(a.ref).localeCompare(refKey(b.ref)),
    );
    for (let n = 0; n < sorted.length; n++) {
      const first = sorted[n];
      const second = sorted
        .slice(n + 1)
        .find(
          (i) =>
            role(i) === role(first) &&
            distance(i.bounds, first.bounds, other(axis)) === 0 &&
            i.bounds[axis] >= first.bounds[axis] + first.bounds[extent(axis)],
        );
      if (second) gaps.push({ axis, first, second });
    }
  }
  return {
    layout,
    units,
    moving,
    fixed,
    bounds,
    scale,
    view,
    gaps,
    bodyGaps: prepareBodyGaps(units, fixed, scale),
  };
}

/**
 * maxGraph Guide.move's edge/centre comparison is a structural reference only;
 * this candidate/lock implementation is original. Zoom and gap arithmetic is
 * adapted from Excalidraw snapping.ts (MIT, Copyright (c) 2020 Excalidraw).
 * See public/third-party/output-alignment.txt for pinned sources and changes.
 */
export function snapMovement(
  session: SnapSession,
  raw: Point,
  enabled = true,
  locks: SnapResult['locks'] = {},
  allowedAxis?: Axis,
): SnapResult {
  const result: SnapResult = { delta: { ...raw }, guides: [], locks: {} };
  if (!enabled || !session.units.length) return result;
  const { bounds, units, moving, fixed, scale } = session;
  const virtual = shift(bounds, raw),
    candidates: Candidate[] = [];
  const add = (
    axis: Axis,
    key: string,
    source: number,
    at: number,
    priority: number,
    target: Rect,
    gap?: Candidate['gap'],
    bodyGap?: BodyGap,
  ) => {
    const delta = at - source;
    if ((!allowedAxis || axis === allowedAxis) && Math.abs(delta - raw[axis]) * scale[axis] <= 10)
      candidates.push({ key: axis + key, axis, delta, priority, target, at, gap, bodyGap });
  };
  for (const target of fixed) {
    for (const axis of ['x', 'y'] as const) {
      const own = target.kind === 'symbol' && units.some((i) => i.ref.id === target.ref.id);
      if (!own && distance(virtual, target.bounds, other(axis)) * scale[other(axis)] > 160)
        continue;
      const key = refKey(target.ref),
        size = extent(axis);
      if (target.referencePoint) {
        add(
          axis,
          key + 'reference',
          bounds[axis] + bounds[size] / 2,
          target.referencePoint[axis],
          own ? 0 : 3,
          target.bounds,
        );
      }
      if (target.kind === 'symbol') continue; // No fake symbol bounding edges.
      for (const factor of [0, 0.5, 1]) {
        const sources = factor === 0.5 ? [0.5] : [0, 1];
        for (const source of sources)
          add(
            axis,
            key + factor + ':' + source,
            bounds[axis] + source * bounds[size],
            target.bounds[axis] + factor * target.bounds[size],
            units.every((i) => role(i) === role(target)) ? 2 : 3,
            target.bounds,
          );
      }
      if (axis === 'y' && target.baselineY !== undefined) {
        for (const source of moving)
          if (source.baselineY !== undefined)
            add(
              'y',
              key + 'baseline' + refKey(source.ref),
              source.baselineY,
              target.baselineY,
              1,
              target.bounds,
            );
      }
    }
  }
  // Only along a parallel wire segment, never pull an arrow perpendicularly onto a wire.
  for (const item of units)
    if (item.kind === 'arrow' && item.path) {
      for (let n = 1; n < item.path.length; n++) {
        const a = item.path[n - 1],
          b = item.path[n];
        const axis: Axis | null =
          Math.abs(a.y - b.y) < 1e-6 ? 'x' : Math.abs(a.x - b.x) < 1e-6 ? 'y' : null;
        if (!axis) continue;
        for (const wire of session.layout.wireSegments) {
          if (Math.abs(wire.start[other(axis)] - wire.end[other(axis)]) > 1e-6) continue;
          const target = unionBounds([
            { ...wire.start, width: 0, height: 0 },
            { ...wire.end, width: 0, height: 0 },
          ]);
          if (
            !intersects(target, session.view) ||
            distance(shift(item.bounds, raw), target, other(axis)) * scale[other(axis)] > 160
          )
            continue;
          for (const [index, source] of [a[axis], (a[axis] + b[axis]) / 2, b[axis]].entries()) {
            for (const [end, at] of [wire.start[axis], wire.end[axis]].entries())
              add(
                axis,
                `wire:${wire.wireId}:${wire.segmentIndex}:${n}:${index}:${end}`,
                source,
                at,
                3,
                target,
              );
          }
        }
      }
    }
  for (const pair of session.bodyGaps) {
    const { axis, before, host, reference, gap } = pair;
    const currentGap = bodyDistance(host, virtual, axis, before);
    if (
      currentGap <= 0 ||
      currentGap * scale[axis] > 160 ||
      overlap(host, virtual, other(axis)) <= 0
    )
      continue;
    const at = before
      ? host[axis] - gap - bounds[extent(axis)]
      : host[axis] + host[extent(axis)] + gap;
    add(
      axis,
      `body-gap:${refKey(reference.ref)}:${before}`,
      bounds[axis],
      at,
      0.5,
      reference.bounds,
      undefined,
      pair,
    );
  }
  for (const { axis, first, second } of session.gaps) {
    if (!units.every((i) => role(i) === role(first))) continue;
    const perpendicular = other(axis),
      size = extent(axis),
      a = first.bounds,
      b = second.bounds;
    if (distance(virtual, a, perpendicular) || distance(virtual, b, perpendicular)) continue;
    const gap = b[axis] - a[axis] - a[size],
      length = bounds[size],
      start = a[axis] + a[size];
    const target = unionBounds([a, b]),
      key = `gap:${refKey(first.ref)}:${refKey(second.ref)}`;
    if (gap >= length) {
      const at = start + (gap - length) / 2;
      add(axis, key + 'between', bounds[axis], at, 4, target, [
        [start, at],
        [at + length, b[axis]],
      ]);
    }
    const after = b[axis] + b[size] + gap,
      before = a[axis] - gap - length;
    add(axis, key + 'after', bounds[axis], after, 4, target, [
      [start, b[axis]],
      [b[axis] + b[size], after],
    ]);
    add(axis, key + 'before', bounds[axis], before, 4, target, [
      [before + length, a[axis]],
      [start, b[axis]],
    ]);
  }
  const chosen: Candidate[] = [];
  for (const axis of ['x', 'y'] as const) {
    const eligible = candidates.filter((c) => c.axis === axis);
    const distance = (c: Candidate) => Math.abs(c.delta - raw[axis]) * scale[axis];
    const entering = eligible.filter((c) => distance(c) <= 6);
    let best = eligible.find((c) => c.key === locks[axis]);
    if (!best) {
      const minimum = Math.min(...entering.map(distance));
      best = entering
        .filter((c) => distance(c) <= minimum + 0.5)
        .sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key))[0];
    }
    // A body-gap target must remain reachable even inside another target's exit radius.
    // Scale the handoff margin down for close targets so none is hidden by hysteresis.
    const retained = best;
    if (retained) {
      const challenger = entering
        .filter((c) => {
          if (!c.bodyGap && !retained.bodyGap) return false;
          const margin = Math.min(1, Math.abs(c.delta - retained.delta) * scale[axis] * 0.25);
          return distance(retained) - distance(c) > margin;
        })
        .sort(
          (a, b) =>
            distance(a) - distance(b) || a.priority - b.priority || a.key.localeCompare(b.key),
        )[0];
      if (challenger) best = challenger;
    }
    if (best) {
      result.delta[axis] = best.delta;
      result.locks[axis] = best.key;
      chosen.push(best);
    }
  }
  // A simultaneous snap on the other axis may move a label beyond its host.
  // Do not retain a body-gap relation whose facing edges no longer overlap.
  for (let i = chosen.length - 1; i >= 0; i--) {
    const c = chosen[i];
    if (c.bodyGap && overlap(c.bodyGap.host, shift(bounds, result.delta), other(c.axis)) <= 0) {
      result.delta[c.axis] = raw[c.axis];
      delete result.locks[c.axis];
      chosen.splice(i, 1);
    }
  }
  for (const c of chosen) {
    const box = shift(bounds, result.delta),
      perpendicular = other(c.axis);
    if (c.bodyGap) {
      const pair = c.bodyGap;
      result.guides.push(
        bodyGapGuide(pair.referenceHost, pair.reference.bounds, c.axis, pair.before),
        bodyGapGuide(pair.host, box, c.axis, pair.before),
      );
    } else if (c.gap) {
      const at =
        Math.max(
          box[perpendicular] + box[extent(perpendicular)],
          c.target[perpendicular] + c.target[extent(perpendicular)],
        ) +
        10 / scale[perpendicular];
      for (const [start, end] of c.gap)
        result.guides.push({
          kind: 'gap',
          start: { x: at, y: at, [c.axis]: start },
          end: { x: at, y: at, [c.axis]: end },
        });
    } else {
      const low = Math.min(box[perpendicular], c.target[perpendicular]),
        high = Math.max(
          box[perpendicular] + box[extent(perpendicular)],
          c.target[perpendicular] + c.target[extent(perpendicular)],
        );
      result.guides.push({
        kind: 'alignment',
        start: { x: c.at, y: c.at, [perpendicular]: low },
        end: { x: c.at, y: c.at, [perpendicular]: high },
      });
    }
  }
  return result;
}
