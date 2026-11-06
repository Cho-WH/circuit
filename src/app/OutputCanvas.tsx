import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import type { CircuitDocument, Point, SimulationResult } from '../domain';
import { annotationPlacements, arrowGeometry, wirePoints } from '../component-library';
import { createSvgExport, type ExportOptions, type OutputRef } from '../export';
import type { Command } from '../editor';
import { useTouchNavigation } from './useTouchNavigation';
import { useCanvasViewport } from './useCanvasViewport';
import { useCanvasWheelZoom } from './useCanvasWheelZoom';
import {
  sameRef,
  refKey,
  normalizeSelection,
  selectionUnits,
  marqueeSelection,
  toggleSelection,
  unionBounds,
  movementCommands,
  outputMoveCommand,
  previewMovement,
  prepareSnap,
  snapMovement,
  type Rect,
  type Guide,
  type SnapSession,
  type SnapResult,
} from './output-layout';

export { outputMoveCommand } from './output-layout';
export type OutputTool = 'select' | 'area' | 'point' | 'arrow' | 'corner-arrow' | 'note';
interface Props {
  readOnly?: boolean;
  document: CircuitDocument;
  result: SimulationResult;
  options: ExportOptions;
  selectedParts: readonly OutputRef[];
  tool: OutputTool;
  snapEnabled: boolean;
  areaAdditive: boolean;
  onSelection: (refs: OutputRef[]) => void;
  onSelect: (id: string | null) => void;
  onTool: (tool: OutputTool) => void;
  onInspect?: () => void;
  dispatch: (command: Command | readonly Command[]) => boolean;
  newId: (prefix: string) => string;
}
type Target = { id: string; part: OutputRef['part'] | 'start' | 'end' };
type Input = { clientX: number; clientY: number; altKey?: boolean; shiftKey?: boolean };
type Gesture = {
  pointer: number;
  start: Point;
  client: Point;
  matrix: DOMMatrix;
  scale: Point;
  view: Rect;
  target: Target | null;
  document: CircuitDocument;
  options: ExportOptions;
  result: SimulationResult;
  moved: boolean;
  kind: 'move' | 'handle' | 'pan' | 'area' | 'insert' | 'inspect';
  selection: OutputRef[];
  previous: readonly OutputRef[];
  additive: boolean;
  snap: SnapSession;
  locks: SnapResult['locks'];
  dragAxis?: 'x' | 'y';
  last: Input;
};
const isHandle = (t: Target | null) => t?.part === 'start' || t?.part === 'end';
const partNames: Record<string, string> = {
  body: '기호',
  label: '이름',
  value: '값',
  annotation: '주석',
  start: '시작 쪽 길이 조절',
  end: '끝 쪽 길이 조절',
  voltage: '전압',
  current: '전류',
};

function snapToWire(doc: CircuitDocument, p: Point, radius: number): Point {
  let best = p,
    distance = radius;
  for (const wire of doc.wires) {
    const points = wirePoints(doc, wire);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        dx = b.x - a.x,
        dy = b.y - a.y;
      const t = Math.max(
        0,
        Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
      );
      const q = { x: a.x + t * dx, y: a.y + t * dy },
        d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < distance) {
        best = q;
        distance = d;
      }
    }
  }
  return best;
}

export function OutputCanvas(props: Props) {
  const svg = useRef<SVGSVGElement>(null),
    gesture = useRef<Gesture | null>(null);
  const frame = useRef<number | null>(null),
    skipClick = useRef(false);
  const [preview, setPreview] = useState<CircuitDocument | null>(null);
  const baseScene = useMemo(
    () => createSvgExport(props.document, props.options, props.result),
    [props.document, props.options, props.result],
  );
  const scene = useMemo(
    () => (preview ? createSvgExport(preview, props.options, props.result) : baseScene),
    [preview, baseScene, props.options, props.result],
  );
  const [view, setView] = useState<Rect>(scene.bounds);
  const [screenScale, setScreenScale] = useState(1);
  const [guides, setGuides] = useState<Guide[]>([]),
    [marquee, setMarquee] = useState<Rect | null>(null);
  const [areaPreview, setAreaPreview] = useState<OutputRef[] | null>(null);
  const [touchInput, setTouchInput] = useState(false),
    [choices, setChoices] = useState<Target[]>([]);
  const selection = normalizeSelection(baseScene.layout, props.selectedParts);
  const units = selectionUnits(scene.layout, areaPreview ?? selection);
  function clearFrame() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }
  function cancel() {
    clearFrame();
    gesture.current = null;
    setPreview(null);
    setGuides([]);
    setMarquee(null);
    setAreaPreview(null);
    skipClick.current = true;
  }
  const touchNavigation = useTouchNavigation(view, setView, screenScale, () => {
    cancel();
    setChoices([]);
  });
  useCanvasWheelZoom(
    svg,
    view,
    setView,
    () => {
      cancel();
      touchNavigation.reset();
      setChoices([]);
    },
    160,
    6000,
  );
  useCanvasViewport(svg, view, setView, () => {
    cancel();
    touchNavigation.reset();
    setChoices([]);
  });
  useEffect(() => {
    const sync = () => setScreenScale(Math.abs(svg.current?.getScreenCTM?.()?.a || 1));
    const observer = new ResizeObserver(sync);
    if (svg.current) observer.observe(svg.current);
    sync();
    return () => observer.disconnect();
  }, [view]);
  useEffect(() => {
    cancel();
    touchNavigation.reset();
    setChoices([]);
  }, [props.document, props.options, props.result, props.tool, props.readOnly]);
  useEffect(() => {
    if (JSON.stringify(selection) !== JSON.stringify(props.selectedParts))
      props.onSelection(selection);
  }, [baseScene, props.selectedParts]);
  useEffect(() => {
    setView(baseScene.bounds);
  }, [props.document.documentId]);
  useEffect(() => {
    setChoices([]);
  }, [view]);
  const latest = useRef({ cancel, refresh: (_key: 'altKey' | 'shiftKey', _pressed: boolean) => {} });
  latest.current = {
    cancel,
    refresh: (key, pressed) => {
      const g = gesture.current;
      if (g) {
        g.last = { ...g.last, [key]: pressed };
        update(g, g.last);
      }
    },
  };
  useEffect(() => {
    const blur = () => latest.current.cancel();
    const modifier = (e: KeyboardEvent) => {
      if ((e.target as Element)?.closest?.('input,textarea,select,[contenteditable]')) return;
      if (e.key === 'Alt') {
        // Windows browsers can focus their menu on Alt release, causing blur
        // and canceling the live preview. Consume Alt only during our gesture.
        if (gesture.current) e.preventDefault();
        latest.current.refresh('altKey', e.type === 'keydown');
      }
      if (e.key === 'Shift') latest.current.refresh('shiftKey', e.type === 'keydown');
      if (e.key === 'Escape') latest.current.cancel();
    };
    window.addEventListener('blur', blur);
    window.addEventListener('keydown', modifier);
    window.addEventListener('keyup', modifier);
    return () => {
      clearFrame();
      window.removeEventListener('blur', blur);
      window.removeEventListener('keydown', modifier);
      window.removeEventListener('keyup', modifier);
    };
  }, []);
  useEffect(() => {
    const g = gesture.current;
    if (g) {
      g.locks = {};
      update(g, g.last);
    }
  }, [props.snapEnabled]);

  const targetName = (t: Target) => {
    const component = props.document.components.find((c) => c.id === t.id),
      annotation = props.document.annotations.find((a) => a.id === t.id);
    return `${component?.label ?? String(annotation?.presentation?.labelText ?? annotation?.content ?? '주석')} · ${annotation?.kind === 'arrow' && t.part === 'label' ? '화살표 기호' : partNames[t.part]}`;
  };
  useEffect(() => {
    for (const element of svg.current?.querySelectorAll<SVGElement>('g[data-output-id]') ?? []) {
      const hit = {
        id: element.getAttribute('data-output-id')!,
        part: element.getAttribute('data-output-part')!,
      } as Target;
      element.setAttribute('data-selected', 'false'); // Selection is drawn from layout, never a parent DOM bbox.
      if (props.readOnly) {
        element.removeAttribute('tabindex');
        element.removeAttribute('role');
        element.removeAttribute('aria-label');
        continue;
      }
      element.setAttribute('tabindex', '0');
      element.setAttribute('role', 'button');
      element.setAttribute('aria-label', targetName(hit).replace(' · ', ' '));
      if (hit.part === 'annotation' && props.document.annotations.some(a => a.id === hit.id && a.kind === 'arrow')) {
        // Parent groups also contain independently positioned text; only the painted
        // arrow or its separate stroke hit area should select the body.
        element.style.pointerEvents = 'visiblePainted';
      }
      if (!isHandle(hit))
        element.setAttribute(
          'aria-pressed',
          String(selection.some((s) => sameRef(s, hit as OutputRef))),
        );
    }
  }, [scene.content, props.selectedParts, props.readOnly]);
  const transform = (e: Input, matrix = svg.current?.getScreenCTM()): Point => {
    if (!matrix) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
    return { x: p.x, y: p.y };
  };
  const hitTarget = (element: Element | null): Target | null => {
    if (props.readOnly) return null;
    const el = element?.closest('[data-output-id]');
    return el
      ? {
          id: el.getAttribute('data-output-id')!,
          part: el.getAttribute('data-output-part')! as Target['part'],
        }
      : null;
  };
  function choose(hit: Target | null, additive = false, inspect = true) {
    setChoices([]);
    const refs =
      hit && !isHandle(hit)
        ? additive
          ? toggleSelection(baseScene.layout, selection, hit as OutputRef)
          : normalizeSelection(baseScene.layout, [hit as OutputRef])
        : [];
    props.onSelection(refs);
    props.onSelect(refs.length > 1 ? null : (hit?.id ?? null));
    if (hit && inspect && !additive) props.onInspect?.();
  }
  function begin(e: Input & { pointerId: number }, hit: Target | null) {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return;
    if (isHandle(hit)) {
      const placement = annotationPlacements(props.document).find(p => p.annotation.id === hit!.id);
      if (placement) {
        const points = arrowGeometry(placement.annotation, placement).points;
        const p = transform(e, matrix), first = points[0], last = points.at(-1)!;
        hit = { id: hit!.id, part: Math.hypot(p.x - first.x, p.y - first.y) < Math.hypot(p.x - last.x, p.y - last.y) ? 'start' : 'end' };
      }
    }
    const scale = {
      x: Math.hypot(matrix.a, matrix.b || 0) || 1,
      y: Math.hypot(matrix.c || 0, matrix.d ?? matrix.a) || 1,
    };
    const additive = !!e.shiftKey || (props.tool === 'area' && props.areaAdditive);
    let refs = selection;
    const kind: Gesture['kind'] = props.readOnly
      ? 'pan'
      : props.tool === 'area'
        ? 'area'
        : props.tool !== 'select'
          ? 'insert'
          : isHandle(hit)
            ? 'handle'
            : hit?.part === 'body'
              ? 'inspect'
              : hit
                ? 'move'
                : 'pan';
    if (kind === 'move' && hit) {
      // Shift-click toggles on release; Shift-drag keeps the grabbed selection.
      refs = selection.some((r) => sameRef(r, hit as OutputRef))
          ? selection
          : normalizeSelection(baseScene.layout, [...(additive ? selection : []), hit as OutputRef]);
      props.onSelection(refs);
      props.onSelect(refs.length === 1 ? refs[0].id : null);
    } else if (kind === 'inspect') {
      props.onSelection([]);
      props.onSelect(hit!.id);
    }
    gesture.current = {
      pointer: e.pointerId,
      start: transform(e, matrix),
      client: { x: e.clientX, y: e.clientY },
      matrix,
      scale,
      view,
      target: hit,
      document: props.document,
      options: props.options,
      result: props.result,
      moved: false,
      kind,
      selection: refs,
      previous: selection,
      additive,
      snap: prepareSnap(baseScene.layout, refs, scale, view),
      locks: {},
      last: e,
    };
    svg.current?.setPointerCapture(e.pointerId);
    svg.current?.focus();
  }
  function valid(g: Gesture) {
    if (g.document !== props.document || g.options !== props.options || g.result !== props.result)
      return false;
    const now = svg.current?.getScreenCTM();
    return (
      g.kind === 'pan' ||
      (!!now && (['a', 'b', 'c', 'd', 'e', 'f'] as const).every((k) => now[k] === g.matrix[k]))
    );
  }
  function evaluate(g: Gesture, e: Input): { commands: Command[]; guides: Guide[] } {
    const p = transform(e, g.matrix),
      raw = { x: p.x - g.start.x, y: p.y - g.start.y };
    if (g.kind === 'move') {
      const previousAxis = g.dragAxis;
      if (!e.shiftKey) g.dragAxis = undefined;
      else if (!g.dragAxis && Math.abs(raw.x) + Math.abs(raw.y) > 1e-8)
        g.dragAxis = Math.abs(raw.x * g.scale.x) >= Math.abs(raw.y * g.scale.y) ? 'x' : 'y';
      if (previousAxis !== g.dragAxis) g.locks = {};
      if (g.dragAxis) raw[g.dragAxis === 'x' ? 'y' : 'x'] = 0;
    }
    if (Math.abs(raw.x) + Math.abs(raw.y) < 1e-8) {
      g.locks = {};
      return { commands: [], guides: [] };
    }
    if (g.kind === 'handle') {
      const command = outputMoveCommand(g.document, g.target!, raw);
      return { commands: command ? [command] : [], guides: [] };
    }
    const snap = snapMovement(g.snap, raw, props.snapEnabled && !e.altKey, g.locks, g.dragAxis);
    g.locks = snap.locks;
    return {
      commands: movementCommands(
        g.document,
        g.selection.map((ref) => ({ ref, delta: snap.delta })),
      ),
      guides: snap.guides,
    };
  }
  function update(g: Gesture, e: Input) {
    if (gesture.current !== g || !valid(g)) {
      cancel();
      return;
    }
    g.last = e;
    if (!g.moved && Math.hypot(e.clientX - g.client.x, e.clientY - g.client.y) <= 4) return;
    g.moved = true;
    if (g.kind === 'area') {
      const p = transform(e, g.matrix),
        box = unionBounds([
          { ...g.start, width: 0, height: 0 },
          { ...p, width: 0, height: 0 },
        ]);
      setMarquee(box);
      setAreaPreview(marqueeSelection(baseScene.layout, box, g.additive ? g.previous : []));
    } else if (g.kind === 'move' || g.kind === 'handle') {
      const evaluated = evaluate(g, e),
        next = previewMovement(g.document, evaluated.commands);
      setPreview(next);
      setGuides(next ? evaluated.guides : []);
    } else if (g.kind === 'pan') {
      setView({
        ...g.view,
        x: g.view.x - (e.clientX - g.client.x) / g.scale.x,
        y: g.view.y - (e.clientY - g.client.y) / g.scale.y,
      });
    }
  }
  function insert(p: Point, alt = false) {
    if (props.readOnly || props.tool === 'select' || props.tool === 'area') return;
    const position = props.snapEnabled && !alt ? snapToWire(props.document, p, 8 / screenScale) : p,
      id = props.newId('note-');
    const arrow = props.tool === 'arrow' || props.tool === 'corner-arrow';
    if (
      props.dispatch({
        type: 'AddAnnotation',
        annotation: {
          id,
          kind: props.tool === 'corner-arrow' ? 'arrow' : props.tool,
          anchor: null,
          position,
          ...(arrow
            ? {
                arrow: {
                  shape:
                    props.tool === 'corner-arrow' ? ('corner' as const) : ('straight' as const),
                  length: 64,
                  legLength: 48,
                  rotation: 0,
                  reversed: false,
                },
              }
            : {}),
          content: props.tool === 'point' ? 'A' : arrow ? 'I' : '글자',
          visibility: 'always',
        },
      })
    ) {
      props.onTool('select');
      props.onSelection([{ id, part: 'annotation' }]);
      props.onSelect(id);
      props.onInspect?.();
    }
  }
  function finish(e: ReactPointerEvent<SVGSVGElement>) {
    const g = gesture.current;
    if (!g || g.pointer !== e.pointerId) return;
    clearFrame();
    if (!valid(g)) {
      cancel();
      return;
    }
    const moved = g.moved || Math.hypot(e.clientX - g.client.x, e.clientY - g.client.y) > 4;
    const rect = e.currentTarget.getBoundingClientRect();
    if (
      rect.width &&
      (e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom)
    ) {
      cancel();
      return;
    }
    const evaluated = moved && (g.kind === 'move' || g.kind === 'handle') ? evaluate(g, e) : null;
    cancel();
    skipClick.current = moved || g.kind === 'area' || g.kind === 'handle';
    if (props.readOnly) return;
    if (g.kind === 'area') {
      const p = transform(e, g.matrix),
        box = unionBounds([
          { ...g.start, width: 0, height: 0 },
          { ...p, width: 0, height: 0 },
        ]);
      const refs = marqueeSelection(baseScene.layout, box, g.additive ? g.previous : []);
      props.onSelection(refs);
      props.onSelect(refs.length === 1 ? refs[0].id : null);
      props.onTool('select');
    } else if (evaluated) {
      if (evaluated.commands.length && previewMovement(g.document, evaluated.commands))
        props.dispatch(evaluated.commands);
    } else if (g.kind === 'insert' && !moved) insert(transform(e, g.matrix), e.altKey);
    else if (!moved && e.pointerType !== 'touch') {
      if (!g.target) choose(null);
      else if (g.kind === 'move' && g.additive) {
        const refs = toggleSelection(baseScene.layout, g.previous, g.target as OutputRef);
        props.onSelection(refs);
        props.onSelect(refs.length === 1 ? refs[0].id : null);
      }
      else if (!g.additive && g.selection.length <= 1) props.onInspect?.();
    }
  }
  function touchTargets(e: Input): Target[] {
    const p = transform(e),
      radius = 22 / screenScale;
    return baseScene.layout.items
      .filter((item) => {
        if (item.path)
          return item.path.slice(1).some((b, i) => {
            const a = item.path![i],
              dx = b.x - a.x,
              dy = b.y - a.y;
            const t = Math.max(
              0,
              Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
            );
            return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y) <= radius;
          });
        const b = item.bounds,
          px = Math.max(0, radius - b.width / 2),
          py = Math.max(0, radius - b.height / 2);
        return (
          p.x >= b.x - px &&
          p.x <= b.x + b.width + px &&
          p.y >= b.y - py &&
          p.y <= b.y + b.height + py
        );
      })
      .map((i) => i.ref);
  }
  function nudge(delta: Point) {
    cancel();
    const commands = movementCommands(
      props.document,
      selection.map((ref) => ({ ref, delta })),
    );
    if (commands.length) props.dispatch(commands);
  }
  function zoom(factor: number) {
    cancel();
    touchNavigation.reset();
    setView((v) => {
      const width = Math.max(160, Math.min(6000, v.width * factor)),
        height = (width * v.height) / v.width;
      return { x: v.x + (v.width - width) / 2, y: v.y + (v.height - height) / 2, width, height };
    });
  }
  const hitRadius = 22 / screenScale;
  return (
    <div
      className="output-canvas-wrap"
      data-readonly={props.readOnly || undefined}
      data-touch={touchInput || undefined}
      data-gesture={gesture.current?.moved ? 'dragging' : touchNavigation.state}
    >
      <svg
        ref={svg}
        className="output-canvas"
        aria-label={props.readOnly ? '회로도 출력 보기' : '회로도 출력 편집'}
        tabIndex={0}
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        onContextMenu={(e) => {
          if (touchInput) e.preventDefault();
        }}
        onPointerDownCapture={(e) => {
          setTouchInput(e.pointerType === 'touch');
          skipClick.current = false;
          if (e.pointerType !== 'touch') {
            touchNavigation.down(e, false);
            return;
          }
          if (props.readOnly) {
            if (touchNavigation.down(e, true)) e.stopPropagation();
            return;
          }
          const direct = hitTarget(e.target as Element),
            handle = isHandle(direct) ? direct : null,
            hits = touchTargets(e);
          const hit =
            handle ??
            hits.find((h) => selection.some((s) => sameRef(s, h as OutputRef))) ??
            (hits.length === 1 ? hits[0] : hits.length ? null : direct);
          const selected = hit && (handle || selection.some((s) => sameRef(s, hit as OutputRef)));
          const area = props.tool === 'area';
          const data = {
            pointerId: e.pointerId,
            clientX: e.clientX,
            clientY: e.clientY,
            shiftKey: e.shiftKey,
            altKey: e.altKey,
          };
          if (
            touchNavigation.down(
              e,
              !area && (!selected || props.tool !== 'select'),
              !area && !selected && hit && hit.part !== 'body' && props.tool === 'select'
                ? () => begin(data, hit)
                : undefined,
            )
          )
            e.stopPropagation();
          else {
            begin(data, area ? null : hit);
            e.stopPropagation();
          }
        }}
        onPointerMoveCapture={(e) => {
          if (touchNavigation.move(e)) {
            setChoices([]);
            e.stopPropagation();
          }
        }}
        onPointerUpCapture={(e) => {
          if (touchNavigation.up(e)) e.stopPropagation();
        }}
        onPointerCancelCapture={(e) => {
          touchNavigation.up(e, true);
          skipClick.current = true;
        }}
        onClickCapture={(e) => {
          if (props.readOnly) {
            e.stopPropagation();
            return;
          }
          if (!touchInput) return;
          e.stopPropagation();
          if (touchNavigation.consumeClick() || skipClick.current) return;
          if (props.tool === 'select') {
            const hits = touchTargets(e);
            if (hits.length > 1) setChoices(hits);
            else choose(hits[0] ?? null);
          } else if (props.tool !== 'area') insert(transform(e), e.altKey);
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          if (gesture.current) {
            if (gesture.current.pointer !== e.pointerId) cancel();
            return;
          }
          begin(e, hitTarget(e.target as Element));
        }}
        onPointerMove={(e) => {
          const g = gesture.current;
          if (!g || g.pointer !== e.pointerId) return;
          g.last = {
            clientX: e.clientX,
            clientY: e.clientY,
            altKey: e.altKey,
            shiftKey: e.shiftKey,
          };
          if (frame.current === null)
            frame.current = requestAnimationFrame(() => {
              frame.current = null;
              if (gesture.current === g) update(g, g.last);
            });
        }}
        onPointerUp={finish}
        onPointerCancel={cancel}
        onLostPointerCapture={(e) => {
          touchNavigation.lost(e);
          if (gesture.current) cancel();
        }}
        onKeyDown={(e) => {
          if (props.readOnly) return;
          const focused = hitTarget(e.target as Element);
          if (e.key === 'Escape') {
            e.stopPropagation();
            cancel();
            touchNavigation.reset();
            setChoices([]);
            props.onTool('select');
            return;
          }
          if (e.key === ' ' && focused && !isHandle(focused)) {
            e.preventDefault();
            e.stopPropagation();
            choose(focused, e.shiftKey, false);
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            if (focused && props.tool === 'select') choose(focused);
            else insert({ x: view.x + view.width / 2, y: view.y + view.height / 2 });
          }
          if (e.key.startsWith('Arrow') && selection.length) {
            e.preventDefault();
            e.stopPropagation();
            const step = e.shiftKey ? 10 : 2;
            const delta = {
              x: e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0,
              y: e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0,
            };
            if (isHandle(focused) && selection.length === 1) {
              const command = outputMoveCommand(props.document, focused!, delta);
              if (command) props.dispatch([command]);
            } else {
              svg.current?.focus();
              nudge(delta);
            }
          }
        }}
      >
        {!props.readOnly &&
          annotationPlacements(preview ?? props.document).map(({ annotation: a, x, y }) =>
            a.kind === 'point' ? (
              <circle
                key={a.id}
                data-output-id={a.id}
                data-output-part="annotation"
                cx={x}
                cy={y}
                r={hitRadius}
                fill="transparent"
              />
            ) : a.kind === 'arrow' ? (
              <path
                key={a.id}
                data-output-id={a.id}
                data-output-part="annotation"
                d={arrowGeometry(a, { x, y }).path}
                stroke="transparent"
                strokeWidth={2 * hitRadius}
                fill="none"
                style={{ pointerEvents: 'stroke' }}
              />
            ) : null,
          )}
        <g dangerouslySetInnerHTML={{ __html: scene.content }} />
        {!props.readOnly &&
          props.document.components.map((c) => (
            <rect
              key={c.id}
              data-output-id={c.id}
              data-output-part="body"
              x={c.position.x - 24}
              y={c.position.y - 24}
              width={48}
              height={48}
              fill="transparent"
              tabIndex={0}
              role="button"
              aria-label={`${c.label} 표기 편집`}
            />
          ))}
        {!props.readOnly && (
          <g className="output-selection-overlay" pointerEvents="none" aria-hidden="true">
            {units.map((i) => (
              <rect
                key={refKey(i.ref)}
                {...i.bounds}
                fill="none"
                stroke="#174895"
                strokeWidth={1.5 / screenScale}
                strokeDasharray={`${4 / screenScale} ${3 / screenScale}`}
              />
            ))}
            {marquee && (
              <rect {...marquee} fill="#1765b51a" stroke="#174895" strokeWidth={1 / screenScale} />
            )}
            {guides.map((g, n) => (
              <g key={n} data-output-guide={g.kind} stroke="#aa3574" strokeWidth={1 / screenScale}>
                <line
                  x1={g.start.x}
                  y1={g.start.y}
                  x2={g.end.x}
                  y2={g.end.y}
                  strokeDasharray={
                    g.kind !== 'gap' ? `${4 / screenScale} ${3 / screenScale}` : undefined
                  }
                />
                {g.kind !== 'alignment' &&
                  [g.start, g.end].map((p, k) => (
                    <line
                      key={k}
                      x1={p.x - (g.start.x === g.end.x ? 4 : 0) / screenScale}
                      y1={p.y - (g.start.y === g.end.y ? 4 : 0) / screenScale}
                      x2={p.x + (g.start.x === g.end.x ? 4 : 0) / screenScale}
                      y2={p.y + (g.start.y === g.end.y ? 4 : 0) / screenScale}
                    />
                  ))}
              </g>
            ))}
          </g>
        )}
        {!props.readOnly &&
          selection.length === 1 &&
          selection[0].part === 'annotation' &&
          annotationPlacements(preview ?? props.document)
            .filter((p) => p.annotation.kind === 'arrow' && p.annotation.id === selection[0].id)
            .flatMap((p) => {
              const points = arrowGeometry(p.annotation, p).points;
              return [
                { part: 'start', point: points[0] },
                { part: 'end', point: points.at(-1)! },
              ].map(({ part, point }) => (
                <g
                  key={p.annotation.id + part}
                  data-output-id={p.annotation.id}
                  data-output-part={part}
                  style={{ cursor: 'grab' }}
                >
                  <circle cx={point.x} cy={point.y} r={hitRadius} fill="transparent" />
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={5 / screenScale}
                    fill="white"
                    stroke="#174895"
                    strokeWidth={1.5 / screenScale}
                    pointerEvents="none"
                  />
                </g>
              ));
            })}
      </svg>
      {choices.length > 0 && (
        <div className="touch-choice-list" aria-label="겹친 출력 대상 선택">
          <span>옮길 대상을 선택하세요</span>
          {choices.map((t) => (
            <button key={t.id + ':' + t.part} onClick={() => choose(t)}>
              {targetName(t)}
            </button>
          ))}
          <button onClick={() => setChoices([])}>취소</button>
        </div>
      )}
      {!props.readOnly && selection.length > 0 && (
        <div className="output-position-tools" aria-label="선택 표기 위치 조절">
          <span>
            {selection.length === 1 ? targetName(selection[0]) : `표기 ${selection.length}개 선택`}
          </span>
          <button aria-label="표기 왼쪽으로" onClick={() => nudge({ x: -2, y: 0 })}>
            ←
          </button>
          <button aria-label="표기 위로" onClick={() => nudge({ x: 0, y: -2 })}>
            ↑
          </button>
          <button aria-label="표기 아래로" onClick={() => nudge({ x: 0, y: 2 })}>
            ↓
          </button>
          <button aria-label="표기 오른쪽으로" onClick={() => nudge({ x: 2, y: 0 })}>
            →
          </button>
        </div>
      )}
      <div className="output-zoom">
        <button aria-label="출력 확대" onClick={() => zoom(0.8)}>
          <Plus size={16} />
        </button>
        <button aria-label="출력 축소" onClick={() => zoom(1.25)}>
          <Minus size={16} />
        </button>
        <button
          aria-label="출력 전체 맞춤"
          onClick={() => {
            cancel();
            touchNavigation.reset();
            setView(scene.bounds);
          }}
        >
          <Maximize size={16} />
        </button>
      </div>
      {props.readOnly && (
        <p className="output-edit-hint">배치·표기 편집은 넓은 화면에서 할 수 있어요.</p>
      )}
    </div>
  );
}
