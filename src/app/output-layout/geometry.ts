import type { CircuitDocument, Point } from '../../domain';
import { annotationPlacements, arrowStyle, resizeArrow } from '../../component-library';
import { previewCommand, type Command } from '../../editor';
import type { OutputLayout, OutputLayoutItem, OutputRef } from '../../export';

export type Rect = OutputLayoutItem['bounds'];
export type Translation = { ref: OutputRef; delta: Point };
export const refKey = (ref: OutputRef) => JSON.stringify([ref.id, ref.part]);
export const sameRef = (a: OutputRef, b: OutputRef) => a.id === b.id && a.part === b.part;
export function unionBounds(rects: readonly Rect[]): Rect {
  if (!rects.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...rects.map((r) => r.x)),
    y = Math.min(...rects.map((r) => r.y));
  return {
    x,
    y,
    width: Math.max(...rects.map((r) => r.x + r.width)) - x,
    height: Math.max(...rects.map((r) => r.y + r.height)) - y,
  };
}
export const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;
export const intersects = (a: Rect, b: Rect) =>
  a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
export function normalizeSelection(layout: OutputLayout, refs: readonly OutputRef[]): OutputRef[] {
  const keys = new Set(refs.map(refKey));
  return layout.items
    .filter(
      (item) =>
        item.movable &&
        keys.has(refKey(item.ref)) &&
        !(item.movesWith && keys.has(refKey(item.movesWith))),
    )
    .map((item) => item.ref);
}
export function selectionUnits(
  layout: OutputLayout,
  refs: readonly OutputRef[],
): OutputLayoutItem[] {
  return normalizeSelection(layout, refs).map((ref) => {
    const item = layout.items.find((i) => sameRef(i.ref, ref))!;
    const children = layout.items.filter((i) => i.movesWith && sameRef(i.movesWith, ref));
    return children.length
      ? { ...item, bounds: unionBounds([item.bounds, ...children.map((i) => i.bounds)]) }
      : item;
  });
}
export function marqueeSelection(
  layout: OutputLayout,
  box: Rect,
  previous: readonly OutputRef[] = [],
): OutputRef[] {
  return normalizeSelection(layout, [
    ...previous,
    ...layout.items.filter((i) => i.movable && contains(box, i.bounds)).map((i) => i.ref),
  ]);
}
export function toggleSelection(
  layout: OutputLayout,
  refs: readonly OutputRef[],
  ref: OutputRef,
): OutputRef[] {
  return normalizeSelection(
    layout,
    refs.some((r) => sameRef(r, ref)) ? refs.filter((r) => !sameRef(r, ref)) : [...refs, ref],
  );
}

/** The existing output fields are the only persisted changes. */
export function outputMoveCommand(
  doc: CircuitDocument,
  target: { id: string; part: string },
  delta: Point,
): Command | null {
  if (target.part === 'body' || Math.abs(delta.x) + Math.abs(delta.y) < 1e-8) return null;
  const placement = annotationPlacements(doc).find((a) => a.annotation.id === target.id);
  if (placement) {
    const { annotation, x, y } = placement;
    if (annotation.kind === 'arrow' && (target.part === 'label' || target.part === 'value')) {
      const prefix = target.part === 'label' ? 'label' : 'answer',
        presentation = annotation.presentation ?? {};
      return {
        type: 'UpdateAnnotation',
        id: target.id,
        changes: {
          presentation: {
            ...presentation,
            [prefix + 'OffsetX']: Number(presentation[prefix + 'OffsetX'] ?? 0) + delta.x,
            [prefix + 'OffsetY']: Number(presentation[prefix + 'OffsetY'] ?? 0) + delta.y,
          },
        },
      };
    }
    if (annotation.kind === 'arrow' && (target.part === 'start' || target.part === 'end')) {
      const changes = resizeArrow(annotation, { x, y }, target.part, delta),
        current = arrowStyle(annotation, { x, y });
      return changes.arrow.length === current.length &&
        changes.arrow.legLength === current.legLength
        ? null
        : { type: 'UpdateAnnotation', id: target.id, changes };
    }
    if (target.part !== 'annotation') return null;
    const end = annotation.end ?? { x: x + 64, y };
    return {
      type: 'UpdateAnnotation',
      id: target.id,
      changes: {
        anchor: null,
        position: { x: x + delta.x, y: y + delta.y },
        ...(annotation.kind === 'arrow'
          ? {
              arrow: arrowStyle(annotation, { x, y }),
              end: { x: end.x + delta.x, y: end.y + delta.y },
            }
          : {}),
      },
    };
  }
  const component = doc.components.find((c) => c.id === target.id);
  if (!component || !['label', 'value', 'voltage', 'current'].includes(target.part)) return null;
  const prefix = target.part === 'value' ? 'answer' : target.part;
  return {
    type: 'SetProperties',
    id: target.id,
    properties: {
      [prefix + 'OffsetX']: Number(component.properties[prefix + 'OffsetX'] ?? 0) + delta.x,
      [prefix + 'OffsetY']: Number(component.properties[prefix + 'OffsetY'] ?? 0) + delta.y,
    },
  };
}
export function movementCommands(
  doc: CircuitDocument,
  translations: readonly Translation[],
): Command[] {
  const commands = new Map<string, Command>();
  for (const { ref, delta } of translations) {
    if (
      ref.part !== 'annotation' &&
      translations.some((t) => t.ref.id === ref.id && t.ref.part === 'annotation')
    )
      continue;
    const next = outputMoveCommand(doc, ref, delta);
    if (!next) continue;
    const previous = commands.get(ref.id);
    if (next.type === 'SetProperties' && previous?.type === 'SetProperties')
      next.properties = { ...previous.properties, ...next.properties };
    if (next.type === 'UpdateAnnotation' && previous?.type === 'UpdateAnnotation') {
      // Only merge changed offsets: each original command also contains untouched presentation fields.
      const prefix = ref.part === 'label' ? 'label' : 'answer';
      next.changes = {
        ...previous.changes,
        presentation: {
          ...previous.changes.presentation,
          [prefix + 'OffsetX']: next.changes.presentation![prefix + 'OffsetX'],
          [prefix + 'OffsetY']: next.changes.presentation![prefix + 'OffsetY'],
        },
      };
    }
    commands.set(ref.id, next);
  }
  return [...commands.values()];
}
export function previewMovement(
  doc: CircuitDocument,
  commands: readonly Command[],
): CircuitDocument | null {
  let next = doc;
  for (const command of commands) {
    const result = previewCommand(next, command);
    if (!result.ok) return null;
    next = result.document;
  }
  return next;
}

export const alignmentLabels = {
  left: '왼쪽 맞춤',
  centerX: '가로 중앙 맞춤',
  right: '오른쪽 맞춤',
  top: '위쪽 맞춤',
  centerY: '세로 중앙 맞춤',
  bottom: '아래쪽 맞춤',
  baseline: '글자 기준선 맞춤',
  gapX: '가로 같은 간격',
  gapY: '세로 같은 간격',
} as const;
export type Alignment = keyof typeof alignmentLabels;

/**
 * Adapted mathematical core of Excalidraw align.ts / distribute.ts (MIT).
 * Copyright (c) 2020 Excalidraw. See public/third-party/output-alignment.txt.
 * Replaces Scene/groups/bindings with immutable output units; fixes endpoints,
 * rejects negative gaps, and adds baseline alignment. No upstream runtime.
 */
export function alignmentMoves(
  units: readonly OutputLayoutItem[],
  action: Alignment,
): Translation[] | null {
  if (units.length < 2) return null;
  if (action === 'baseline') {
    if (units.some((i) => !['text', 'blank', 'note'].includes(i.kind) || i.baselineY === undefined))
      return null;
    const baselines = units.map((i) => i.baselineY!);
    const target = (Math.min(...baselines) + Math.max(...baselines)) / 2;
    return units.map((i) => ({ ref: i.ref, delta: { x: 0, y: target - i.baselineY! } }));
  }
  const axis = ['left', 'right', 'centerX', 'gapX'].includes(action) ? 'x' : 'y';
  const size = axis === 'x' ? 'width' : 'height';
  if (action === 'gapX' || action === 'gapY') {
    if (units.length < 3) return null;
    const sorted = [...units].sort(
      (a, b) => a.bounds[axis] - b.bounds[axis] || refKey(a.ref).localeCompare(refKey(b.ref)),
    );
    const first = sorted[0].bounds,
      last = sorted.at(-1)!.bounds;
    const gap =
      (last[axis] + last[size] - first[axis] - sorted.reduce((sum, i) => sum + i.bounds[size], 0)) /
      (sorted.length - 1);
    if (gap < 0) return null;
    let cursor = first[axis];
    return sorted.map((i, index) => {
      const delta = { x: 0, y: 0 };
      if (index > 0 && index < sorted.length - 1) delta[axis] = cursor - i.bounds[axis];
      cursor += i.bounds[size] + gap;
      return { ref: i.ref, delta };
    });
  }
  const bounds = unionBounds(units.map((i) => i.bounds));
  const factor =
    action === 'centerX' || action === 'centerY'
      ? 0.5
      : action === 'right' || action === 'bottom'
        ? 1
        : 0;
  return units.map((i) => ({
    ref: i.ref,
    delta: {
      x: 0,
      y: 0,
      [axis]: bounds[axis] + factor * bounds[size] - i.bounds[axis] - factor * i.bounds[size],
    },
  }));
}
