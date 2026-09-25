import { InlineComponentEditor, type ComponentEdit } from './InlineComponentEditor';
import { SvgNotation } from './Notation';
import { PlacementFailure } from './PlacementFailure';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  useCanvasDragSession,
  dragPositions,
  wireDragCommand,
  snapCanvasPoint as snap,
} from './useCanvasDragSession';
import type { CircuitDocument, ComponentType, EndpointRef, Point } from '../domain';
import { insertionCandidates, previewCommand, type Command } from '../editor';
import {
  useContextWiring,
  WiringMarks,
  WiringOverlay,
  WireSegmentHandles,
  endpointTarget,
  wiringTargets,
} from './wiring';
import { MeasurementLayer, measurementHit } from './measurement-tools';
import type { MeasurementLayerProps } from './measurement-tools/MeasurementLayer';
import { useTouchNavigation } from './useTouchNavigation';
import { useCanvasViewport } from './useCanvasViewport';
import { useCanvasWheelZoom } from './useCanvasWheelZoom';
import type { PaletteDrag } from './ComponentPalette';
import { compactWirePoints } from '../component-library';
import {
  componentDefinitions,
  circuitTextScale,
  componentNotationLayout,
  componentValueFontSize,
  createComponent,
  wireCrossings,
  wirePath,
  componentValue,
  documentBounds,
  endpointPosition,
  pointsAttribute,
  symbolMarkup,
  terminalPosition,
  wirePoints,
} from '../component-library';

export interface CanvasProps {
  paletteDrag?: PaletteDrag | null;
  initialView?: { x: number; y: number; width: number; height: number };
  viewLabel?: ReactNode;
  onViewChange?: (view: { x: number; y: number; width: number; height: number }) => void;
  readOnly?: boolean;
  readOnlyLabel?: string;
  onWiringCommit?: (commands: readonly Command[]) => boolean;
  wiringResetKey?: number;
  document: CircuitDocument;
  selected: string[];
  tool: string;
  placement: ComponentType | null;
  onSelect: (id: string | null, additive?: boolean) => void;
  onMove: (positions: Record<string, Point>) => void;
  onPlace: (
    type: ComponentType,
    point: Point,
    target?: { wireId: string; segment: number },
  ) => void;
  onCommitComponent?: (id: string, edit: ComponentEdit) => boolean;
  onCancel?: () => void;
  onAction?: (action: 'rotate' | 'copy' | 'delete') => void;
  focusIds?: string[];
  onEndpoint: (endpoint: EndpointRef) => void;
  onWire: (id: string, point: Point) => void;
  onValue: (id: string) => void;
  onSwitch: (id: string) => boolean | void;
  onBackground: (point: Point) => void;
  endpointColors?: Record<string, string>;
  endpointLabels?: Record<string, string>;
  endpointGroups?: Record<string, string>;
  highlightedEndpoints?: string[];
  highlightedElements?: string[];
  onHoverElement?: (id: string | null) => void;
  currentArrows?: Record<string, number>;
  measurement?: Omit<MeasurementLayerProps, 'document' | 'scale' | 'bounds' | 'point'>;
  largeLabels?: boolean;
}
export function CircuitCanvas(props: CanvasProps) {
  const { document, selected, tool, placement } = props;
  const svg = useRef<SVGSVGElement>(null);
  const [view, setView] = useState(() => props.initialView ?? documentBounds(document, 110));
  useEffect(() => {
    setView(props.initialView ?? documentBounds(document, 110));
  }, [document.documentId]);
  useEffect(() => {
    props.onViewChange?.(view);
  }, [view]);
  const [pointer, setPointer] = useState<Point>({ x: 500, y: 300 });
  const [insertionWire, setInsertionWire] = useState<string>();
  const [choosingInsertion, setChoosingInsertion] = useState(false);
  const [touchCandidates, setTouchCandidates] = useState<ReturnType<
    typeof insertionCandidates
  > | null>(null);
  useEffect(() => {
    setTouchCandidates(null);
  }, [document, tool, placement]);
  const [touchInput, setTouchInput] = useState(false);
  const [tapMove, setTapMove] = useState(false);
  const [componentChoices, setComponentChoices] = useState<string[]>([]);
  const [measurementCancel, setMeasurementCancel] = useState(0);
  const placementPointer = useRef<number | null>(null);
  const [placementMessage, setPlacementMessage] = useState('');
  const [placementFailure, setPlacementFailure] = useState<{ point: Point; attempt: number } | null>(null);
  function rejectPlacement(point: Point) {
    setPlacementMessage('');
    setChoosingInsertion(false);
    setPlacementFailure(previous => ({ point, attempt: (previous?.attempt ?? 0) + 1 }));
  }
  const keepSwitchEditor=useRef(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  useEffect(() => {
    if(!keepSwitchEditor.current)setEditingId(null);
    keepSwitchEditor.current=false;
    setInsertionWire(undefined);
    setChoosingInsertion(false);
    setPlacementMessage('');
    setPlacementFailure(null);
  }, [document, tool, placement, props.readOnly]);
  const dragSession = useCanvasDragSession(document, tool, placement, props.readOnly, svg);
  const { drag, activeDrag, activeWireDrag, pan, capturedPointer, movedDocument } = dragSession;
  function cancelGesture() {
    dragSession.cancel();
    setTapMove(false);
    placementPointer.current = null;
    setMeasurementCancel((n) => n + 1);
  }
  useEffect(() => {
    cancelGesture();
  }, [document, tool, placement, props.readOnly]);
  useEffect(() => {
    const cancel = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelGesture();
        touchNavigation.reset();
        setComponentChoices([]);
      }
    };
    window.addEventListener('keydown', cancel);
    window.addEventListener('blur', cancelGesture);
    return () => {
      window.removeEventListener('keydown', cancel);
      window.removeEventListener('blur', cancelGesture);
    };
  }, []);
  const viewport = useCanvasViewport(
    svg,
    view,
    setView,
    () => {
      cancelGesture();
      touchNavigation.reset();
      wiring.clearHint();
    },
    document.components.find((c) => c.id === (editingId ?? selected[0]))?.position,
    Boolean(editingId),
  );
  const drawingScale = Math.max(
    0.01,
    Math.min(viewport.width / view.width, viewport.height / view.height),
  );
  const wiring = useContextWiring({
    document,
    enabled:
      Boolean(props.onWiringCommit) &&
      !props.readOnly &&
      !placement &&
      !tapMove &&
      (tool === 'select' || tool === 'wire'),
    tool,
    selected,
    resetKey: props.wiringResetKey,
    onSelect: props.onSelect,
    commit: props.onWiringCommit,
    onFinish: props.onCancel,
  });
  const touchNavigation = useTouchNavigation(view, setView, drawingScale, cancelGesture);
  useCanvasWheelZoom(
    svg,
    view,
    setView,
    () => {
      cancelGesture();
      touchNavigation.reset();
    },
    200,
    5000,
  );
  useEffect(() => {
    touchNavigation.reset();
  }, [document, tool, placement, props.readOnly]);
  useEffect(() => {
    setComponentChoices([]);
    wiring.clearHint();
  }, [view]);
  useEffect(() => {
    setComponentChoices([]);
  }, [document, tool, placement]);
  const inputType = useRef('mouse');
  const cancelWiring = () => {
    wiring.cancel();
    props.onCancel?.();
  };
  useEffect(() => {
    if (!props.focusIds?.length) return;
    const points = [
      ...document.components.filter((c) => props.focusIds!.includes(c.id)).map((c) => c.position),
      ...document.junctions.filter((j) => props.focusIds!.includes(j.id)).map((j) => j.position),
      ...document.wires
        .filter((w) => props.focusIds!.includes(w.id))
        .flatMap((w) => wirePoints(document, w)),
    ];
    if (points.length)
      setView((v) => ({
        ...v,
        x: points.reduce((sum, p) => sum + p.x, 0) / points.length - v.width / 2,
        y: points.reduce((sum, p) => sum + p.y, 0) / points.length - v.height / 2,
      }));
  }, [props.focusIds]);
  const minimumLabelScale =
    props.measurement && viewport.width < 640 ? 0.95 : 0.85 * circuitTextScale;
  const labelScale = Math.max(
    props.largeLabels ? 2.25 : circuitTextScale,
    minimumLabelScale / drawingScale,
  );
  useEffect(() => {
    if (placement) setPointer(snap({ x: view.x + view.width / 2, y: view.y + view.height / 2 }));
  }, [placement]);
  function point(clientX: number, clientY: number): Point {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: p.x, y: p.y };
  }
  function bodyTargets(x: number, y: number): string[] {
    return [...(svg.current?.querySelectorAll<SVGElement>('.component-hit') ?? [])]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.width > 0 &&
          x >= r.left - 12 &&
          x <= r.right + 12 &&
          y >= r.top - 12 &&
          y <= r.bottom + 12
        );
      })
      .map((el) => el.closest('[data-component-id]')!.getAttribute('data-component-id')!);
  }
  function beginDrag(id: string, start: Point, pointerId: number) {
    const ids = selected.includes(id) ? selected : [id];
    props.onSelect(id);
    wiring.clearHint();
    dragSession.beginComponents(ids, start, pointerId);
  }
  const candidates = placement
    ? (touchCandidates ?? insertionCandidates(document, snap(pointer)))
    : [];
  const chosenCandidates = insertionWire
    ? candidates.filter((c) => `${c.wireId}:${c.segment}` === insertionWire)
    : candidates;
  const candidate = chosenCandidates.length === 1 ? chosenCandidates[0] : undefined;
  let previewId = '__placement';
  const usedIds = new Set(
    [
      ...document.components,
      ...document.components.flatMap((c) => c.terminals),
      ...document.wires,
      ...document.junctions,
      ...document.annotations,
    ].map((x) => x.id),
  );
  while (
    [previewId, previewId + '.a', previewId + '.b', previewId + '.wire'].some((id) =>
      usedIds.has(id),
    )
  )
    previewId += '_';
  const previewComponent = placement
    ? createComponent(placement, previewId, candidate?.position ?? snap(pointer))
    : null;
  if (previewComponent && candidate) previewComponent.rotation = candidate.rotation;
  const insertionPreview =
    previewComponent && candidate && !candidate.reason && placement !== 'voltmeter'
      ? previewCommand(document, {
          type: 'InsertComponentOnWire',
          component: previewComponent,
          wireId: candidate.wireId,
          segment: candidate.segment,
          newWireId: previewId + '.wire',
        })
      : null;
  const effective = insertionPreview?.ok ? insertionPreview.document : movedDocument;
  const crossings = wireCrossings(effective);
  function placeAt(type: ComponentType, p: Point, touchConfirm = false) {
    const all =
      touchConfirm && touchCandidates ? touchCandidates : insertionCandidates(document, p);
    const options = insertionWire
      ? all.filter((c) => `${c.wireId}:${c.segment}` === insertionWire)
      : all;
    if (all.length) {
      if (all.every(c => c.reason) || type === 'voltmeter') { rejectPlacement(p); return; }
      if (options.length !== 1) {
        setPointer(p);
        setChoosingInsertion(true);
        setPlacementMessage('겹친 도선 중 삽입할 도선을 선택하세요.');
        return;
      }
      const target = options[0];
      if (target.reason) {
        rejectPlacement(p);
        return;
      }
      props.onPlace(type, target.position, { wireId: target.wireId, segment: target.segment });
    } else if (document.junctions.some(j => Math.hypot(j.position.x-p.x, j.position.y-p.y) < 56)) rejectPlacement(p);
    else props.onPlace(type, p);
  }
  function touchInsertionOptions(p: Point): ReturnType<typeof insertionCandidates> {
    // Use the same normalized routes as mouse preview and the insertion command.
    return insertionCandidates(document, p, undefined, 18 / drawingScale).flatMap(candidate => {
      const q = candidate.position;
      const aligned = candidate.rotation === 90 ? { x: q.x, y: snap(q).y } : { x: snap(q).x, y: q.y };
      return insertionCandidates(document, aligned, candidate.wireId).filter(c => c.segment === candidate.segment);
    });
  }
  function touchPlacementPoint(p: Point): Point {
    const options = touchInsertionOptions(p);
    setTouchCandidates(options);
    return options.length === 1 ? options[0].position : snap(p);
  }
  function touchPlaceAt(type: ComponentType, p: Point) {
    const options = touchInsertionOptions(p),
      target = options.length === 1 ? options[0].position : snap(p);
    setTouchCandidates(options);
    setPointer(target);
    setInsertionWire(undefined);
    setPlacementMessage('');
    if (options.length) {
      if (options.every(c => c.reason) || type === 'voltmeter') { rejectPlacement(target); return; }
      setChoosingInsertion(true);
      return;
    }
    setChoosingInsertion(false);
    if (document.junctions.some(j => Math.hypot(j.position.x-target.x, j.position.y-target.y) < 56)) rejectPlacement(target);
    else props.onPlace(type, target);
  }
  useEffect(() => {
    const e = props.paletteDrag;
    if (!e || props.readOnly) return;
    inputType.current = 'touch';
    setTouchInput(true);
    if (e.phase === 'cancel') {
      cancelGesture();
      setChoosingInsertion(false);
      return;
    }
    if (placement !== e.type) return;
    const rect = svg.current?.getBoundingClientRect();
    const inside =
      rect && e.x >= rect.left && e.x <= rect.right && e.y >= rect.top && e.y <= rect.bottom;
    if (inside) {
      setPointer(touchPlacementPoint(point(e.x, e.y)));
      setChoosingInsertion(false);
      setInsertionWire(undefined);
    }
    if (e.phase === 'drop') {
      if (inside) touchPlaceAt(e.type, point(e.x, e.y));
      else props.onCancel?.();
    }
  }, [props.paletteDrag]);
  function editValue(id: string, fromAction = false) {
    const c = document.components.find((c) => c.id === id),
      def = c && componentDefinitions[c.type];
    if (!c || !def) return;
    if (c.type === 'switch' && !fromAction) {
      props.onSwitch(id);
      return;
    }
    props.onSelect(id);
    if (props.onCommitComponent) setEditingId(id);
    else props.onValue(id);
  }
  function closeEditor() {
    const id = editingId;
    setEditingId(null);
    window.setTimeout(() => {
      const target = [...(svg.current?.querySelectorAll<SVGElement>('.editable-value') ?? [])].find(
        (el) => el.getAttribute('data-value-id') === id,
      );
      target?.focus();
    }, 0);
  }
  const editingComponent = document.components.find((c) => c.id === editingId);
  const screenPoint = (p: Point) => ({
    x: (viewport.width - view.width * drawingScale) / 2 + (p.x - view.x) * drawingScale,
    y: (viewport.height - view.height * drawingScale) / 2 + (p.y - view.y) * drawingScale,
  });
  const editorPoint = editingComponent ? screenPoint(editingComponent.position) : { x: 0, y: 0 };
  const selectedComponent = document.components.find((c) => c.id === selected[0]);
  const selectionPoint = selectedComponent
    ? screenPoint(selectedComponent.position)
    : { x: 0, y: 0 };
  // One callout per electrical net. Reserve component label areas before placing callouts.
  const occupied = effective.components.map((c) => ({
    x: c.position.x - 68 * labelScale,
    y: c.position.y - 55 * labelScale,
    w: 136 * labelScale,
    h: 110 * labelScale,
  }));
  const seenNets = new Set<string>();
  const callouts = [
    ...effective.junctions.map((j) => ({ id: j.id, point: j.position })),
    ...effective.components.flatMap((c) =>
      c.terminals.map((t, i) => ({ id: t.id, point: terminalPosition(c, i) })),
    ),
  ].flatMap(({ id, point: anchor }) => {
    const text = props.endpointLabels?.[id];
    const group = props.endpointGroups?.[id] ?? id;
    if (!text || seenNets.has(group)) return [];
    seenNets.add(group);
    const w = Math.max(50, text.length * 7.5 + 12) * labelScale,
      h = 22 * labelScale;
    const clampBox = (x: number, y: number) => ({
      x: Math.max(view.x + 12 * labelScale, Math.min(view.x + view.width - w - 12 * labelScale, x)),
      y: Math.max(
        view.y + 12 * labelScale,
        Math.min(view.y + view.height - h - 35 * labelScale, y),
      ),
      w,
      h,
    });
    let box = clampBox(anchor.x - w / 2, anchor.y - 90 * labelScale);
    outer: for (let ring = 0; ring < 20; ring++)
      for (const dy of [-1, 1])
        for (const dx of [0, -1, 1]) {
          const candidate = clampBox(
            anchor.x - w / 2 + dx * (w + 12 * labelScale),
            anchor.y + dy * (70 + ring * 28) * labelScale,
          );
          if (
            !occupied.some(
              (b) =>
                candidate.x < b.x + b.w + 6 &&
                candidate.x + w + 6 > b.x &&
                candidate.y < b.y + b.h + 6 &&
                candidate.y + h + 6 > b.y,
            )
          ) {
            box = candidate;
            break outer;
          }
        }
    occupied.push(box);
    return [{ id, text, anchor, ...box }];
  });
  const endColor = (id: string) => props.endpointColors?.[id] ?? '#263548';
  const highlighted = (id: string) => props.highlightedEndpoints?.includes(id);
  const zoom = (factor: number) =>
    setView((v) => {
      const width = Math.min(5000, Math.max(200, v.width * factor));
      const height = (width * v.height) / v.width;
      return { x: v.x + (v.width - width) / 2, y: v.y + (v.height - height) / 2, width, height };
    });
  function chooseEndpoint(ref: EndpointRef) {
    if (wiring.active)
      wiring.activate(endpointTarget(document, ref), inputType.current === 'touch');
    else props.onEndpoint(ref);
  }
  const wireOrigin = wiring.active ? wiring.start?.point : null;
  const isWireStart = (id: string) =>
    wiring.start?.kind === 'endpoint' && wiring.start.ref.id === id;
  return (
    <div
      data-touch={touchInput || undefined}
      data-gesture={activeDrag ? 'dragging' : touchNavigation.state}
      className={`canvas-shell ${editingId ? 'is-editing ' : ''}${placement ? 'placing' : ''} ${wiring.active ? 'smart-wiring' : ''}`}
      onKeyDownCapture={(e) => {
        if (!wiring.start || e.ctrlKey || e.metaKey || e.altKey) return;
        if (
          e.key === 'Enter' &&
          (e.target as Element).closest('[data-endpoint-id],[data-wire-id],[data-wiring-ui]')
        )
          return;
        if (
          !['Backspace', '/', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
            e.key,
          )
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Backspace') wiring.back();
        else if (e.key === '/') wiring.togglePosture();
        else if (e.key === 'Enter') wiring.tap(wiring.cursor, drawingScale, false);
        else {
          wiring.nudge(
            e.key === 'ArrowRight' ? 20 : e.key === 'ArrowLeft' ? -20 : 0,
            e.key === 'ArrowDown' ? 20 : e.key === 'ArrowUp' ? -20 : 0,
            drawingScale,
          );
          svg.current?.focus({ preventScroll: true });
        }
      }}
    >
      <svg
        ref={svg}
        className="circuit-canvas"
        aria-label={props.readOnly ? (props.readOnlyLabel ?? '측정 회로') : '회로 편집 캔버스'}
        role="group"
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        tabIndex={0}
        onPointerDownCapture={(e) => {
          if (tapMove && e.pointerType !== 'touch') {
            touchNavigation.down(e, false);
            e.stopPropagation();
            return;
          }
          if (e.pointerType !== 'touch') setTouchCandidates(null);
          inputType.current = e.pointerType;
          setTouchInput(e.pointerType === 'touch');
          wiring.setTouch(e.pointerType === 'touch');
          const target = e.target as Element;
          if (target.closest('[data-wiring-ui]')) return;
          const componentId = target
            .closest('[data-component-id]')
            ?.getAttribute('data-component-id');
          const bodies = e.pointerType === 'touch' ? bodyTargets(e.clientX, e.clientY) : [];
          const hits = wiring.active
            ? wiringTargets(
                document,
                point(e.clientX, e.clientY),
                drawingScale,
                Boolean(wiring.start),
              )
            : [];
          const wireHandle = target.closest('[data-wire-handle]');
          const handle = wireHandle || target.closest('[data-measurement-handle]');
          const selectedBody =
            !placement &&
            !tapMove &&
            (handle ||
              target.closest('.editable-value') ||
              (componentId && selected.includes(componentId) && !hits.length));
          const p = point(e.clientX, e.clientY),
            id = e.pointerId;
          if (e.pointerType === 'touch' && placement) {
            setPointer(touchPlacementPoint(p));
            setInsertionWire(undefined);
            setChoosingInsertion(false);
          }
          const hold =
            placement && !props.readOnly
              ? () => {
                  placementPointer.current = id;
                  svg.current?.setPointerCapture(id);
                }
              : componentId &&
                  bodies.length <= 1 &&
                  !selectedBody &&
                  !hits.length &&
                  !props.readOnly &&
                  !tapMove &&
                  tool === 'select' &&
                  !target.closest('.editable-value')
                ? () => beginDrag(componentId, p, id)
                : undefined;
          if (touchNavigation.down(e, !selectedBody, hold)) {
            e.stopPropagation();
            return;
          }
          if (
            wiring.active &&
            (hits.length || wiring.start) &&
            !wireHandle &&
            !target.closest('.editable-value')
          )
            e.stopPropagation();
        }}
        onPointerMoveCapture={(e) => {
          if (touchNavigation.move(e)) {
            wiring.clearHint();
            e.stopPropagation();
            return;
          }
          if (
            !activeDrag &&
            !activeWireDrag &&
            !pan &&
            (e.pointerType !== 'touch' || wiring.start)
          ) {
            wiring.setTouch(e.pointerType === 'touch');
            wiring.hover(point(e.clientX, e.clientY), drawingScale);
          }
        }}
        onPointerUpCapture={(e) => {
          if (touchNavigation.up(e)) e.stopPropagation();
        }}
        onPointerCancelCapture={(e) => {
          touchNavigation.up(e, true);
        }}
        onClickCapture={(e) => {
          if (touchNavigation.consumeClick()) {
            e.stopPropagation();
            e.preventDefault();
            return;
          }
          const target = (
            inputType.current === 'touch'
              ? (svg.current?.ownerDocument.elementFromPoint?.(e.clientX, e.clientY) ?? e.target)
              : e.target
          ) as Element | null;
          if (target?.closest('[data-wiring-ui],[data-wire-handle]')) return;
          if (tapMove && drag) {
            e.stopPropagation();
            dragSession.moveTo(snap(point(e.clientX, e.clientY)));
            return;
          }
          if (inputType.current === 'touch' && placement && !props.readOnly) {
            e.stopPropagation();
            touchPlaceAt(placement, point(e.clientX, e.clientY));
            return;
          }
          if (props.measurement) {
            if (inputType.current === 'touch' && e.target === svg.current) {
              const hit = measurementHit(
                document,
                point(e.clientX, e.clientY),
                drawingScale,
                props.measurement.tool,
              );
              if (hit) props.measurement.onPlace(props.measurement.tool, hit);
              e.stopPropagation();
            }
            return;
          }
          if (
            inputType.current === 'touch' &&
            !wiring.start &&
            tool === 'select' &&
            !target?.closest('[data-endpoint-id]')
          ) {
            const bodies = bodyTargets(e.clientX, e.clientY);
            if (bodies.length > 1) {
              e.stopPropagation();
              wiring.clearHint();
              setComponentChoices(bodies);
              return;
            }
          }
          if (target?.closest('.editable-value')) return;
          if (
            wiring.active &&
            wiring.tap(point(e.clientX, e.clientY), drawingScale, inputType.current === 'touch')
          ) {
            e.stopPropagation();
            return;
          }
          if (inputType.current === 'touch') {
            const endpointElement = target?.closest('[data-endpoint-id]');
            if (!wiring.active && endpointElement) {
              e.stopPropagation();
              chooseEndpoint({
                kind: endpointElement.getAttribute('data-endpoint-kind') as EndpointRef['kind'],
                id: endpointElement.getAttribute('data-endpoint-id')!,
              });
              return;
            }
            const wireElement = target?.closest('[data-wire-id]');
            if (!wiring.active && wireElement) {
              e.stopPropagation();
              props.onWire(
                wireElement.getAttribute('data-wire-id')!,
                snap(point(e.clientX, e.clientY)),
              );
              return;
            }
            const id = target?.closest('[data-component-id]')?.getAttribute('data-component-id');
            if (id) {
              wiring.cancel();
              props.onSelect(id);
            } else {
              wiring.clearHint();
              props.onSelect(null);
            }
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setPointer(point(e.clientX, e.clientY));
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (props.readOnly) return;
          const type = e.dataTransfer.getData('component') as ComponentType;
          if (
            [
              'dc-voltage-source',
              'resistor',
              'switch',
              'ammeter',
              'voltmeter',
              'resistive-load',
            ].includes(type)
          )
            placeAt(type, snap(point(e.clientX, e.clientY)));
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (!props.readOnly && placement && e.key === 'Enter') {
            e.preventDefault();
            placeAt(placement, snap(pointer));
          }
          if (!props.readOnly && placement && e.key.startsWith('Arrow')) {
            e.preventDefault();
            e.stopPropagation();
            setPointer((p) =>
              snap({
                x: p.x + (e.key === 'ArrowRight' ? 20 : e.key === 'ArrowLeft' ? -20 : 0),
                y: p.y + (e.key === 'ArrowDown' ? 20 : e.key === 'ArrowUp' ? -20 : 0),
              }),
            );
          }
          if (e.key === '+' || e.key === '=') zoom(0.8);
          if (e.key === '-') zoom(1.25);
          if (tool === 'select' && !placement && !wiring.active && e.key.startsWith('Arrow')) {
            e.preventDefault();
            e.stopPropagation();
            setView((v) => ({
              ...v,
              x: v.x + (e.key === 'ArrowRight' ? 40 : e.key === 'ArrowLeft' ? -40 : 0),
              y: v.y + (e.key === 'ArrowDown' ? 40 : e.key === 'ArrowUp' ? -40 : 0),
            }));
          }
        }}
        onPointerDown={(e) => {
          if (tapMove) return;
          if (capturedPointer.current !== null) return;
          if (e.button === 1) {
            e.preventDefault();
            dragSession.beginPan(e.clientX, e.clientY, view, e.pointerId);
            return;
          }
          if (e.button !== 0) return;
          if (wiring.start) return;
          if (placement && !props.readOnly) {
            e.preventDefault();
            placeAt(placement, snap(point(e.clientX, e.clientY)));
            return;
          }
          if (
            e.target !== e.currentTarget &&
            !(e.target as Element).classList.contains('canvas-background')
          )
            return;
          const p = snap(point(e.clientX, e.clientY));
          wiring.clearHint();
          props.onSelect(null);
          props.onBackground(p);
          if (tool === 'select' && e.pointerType !== 'touch') {
            e.preventDefault();
            dragSession.beginPan(e.clientX, e.clientY, view, e.pointerId);
          }
        }}
        onPointerMove={(e) => {
          const p = point(e.clientX, e.clientY);
          if (!choosingInsertion && !tapMove) {
            setPointer(placement && e.pointerType === 'touch' ? touchPlacementPoint(p) : p);
            setPlacementMessage('');
          }
          if (pan && capturedPointer.current === e.pointerId && svg.current) {
            const scale = 1 / drawingScale;
            setView({
              ...pan.view,
              x: pan.view.x - (e.clientX - pan.x) * scale,
              y: pan.view.y - (e.clientY - pan.y) * scale,
            });
          }
          dragSession.move(e.pointerId, p);
        }}
        onPointerUp={(e) => {
          if (placementPointer.current === e.pointerId && placement) {
            const r = e.currentTarget.getBoundingClientRect();
            if (
              e.clientX >= r.left &&
              e.clientX <= r.right &&
              e.clientY >= r.top &&
              e.clientY <= r.bottom
            )
              touchPlaceAt(placement, point(e.clientX, e.clientY));
            cancelGesture();
            return;
          }
          if (capturedPointer.current !== e.pointerId) return;
          if (activeWireDrag?.pointerId === e.pointerId) {
            const command = wireDragCommand(activeWireDrag, point(e.clientX, e.clientY));
            const rect = e.currentTarget.getBoundingClientRect();
            const inside =
              !rect.width ||
              (e.clientX >= rect.left &&
                e.clientX <= rect.right &&
                e.clientY >= rect.top &&
                e.clientY <= rect.bottom);
            touchNavigation.suppress();
            if (inside && command.offset) props.onWiringCommit?.([command]);
          }
          // Commit the release coordinates, not a possibly older pointermove render.
          if (activeDrag?.pointerId === e.pointerId) {
            const positions = dragPositions(activeDrag, point(e.clientX, e.clientY));
            const rect = e.currentTarget.getBoundingClientRect();
            const inside =
              !rect.width ||
              (e.clientX >= rect.left &&
                e.clientX <= rect.right &&
                e.clientY >= rect.top &&
                e.clientY <= rect.bottom);
            if (Object.keys(positions).length && e.pointerType === 'touch')
              touchNavigation.suppress();
            if (inside && Object.keys(positions).length) props.onMove(positions);
          }
          cancelGesture();
        }}
        onContextMenu={(e) => {
          if (inputType.current === 'touch') e.preventDefault();
        }}
        onPointerCancel={(e) => {
          if (capturedPointer.current === e.pointerId) cancelGesture();
        }}
        onLostPointerCapture={(e) => {
          touchNavigation.lost(e);
          if (capturedPointer.current === e.pointerId) cancelGesture();
        }}
      >
        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <circle cx="0" cy="0" r="1" fill="#d5dce3" />
          </pattern>
        </defs>
        <rect
          className="canvas-background"
          x={view.x}
          y={view.y}
          width={view.width}
          height={view.height}
          fill="url(#grid)"
        />
        {!document.components.length && (
          <g pointerEvents="none">
            <text x="500" y="270" textAnchor="middle" fontSize="24" fill="#5c6978">
              {props.readOnly ? '측정할 회로가 없습니다' : '첫 번째 회로를 그려볼까요?'}
            </text>
            <text x="500" y="306" textAnchor="middle" fontSize="15" fill="#8290a0">
              {props.readOnly
                ? '회로 편집에서 부품을 추가하세요'
                : '왼쪽에서 부품을 선택하고 이곳에 놓으세요.'}
            </text>
          </g>
        )}
        {effective.wires.map((w) => (
          <g key={w.id} className="wire-element">
            <path
              className="wire-ink"
              d={wirePath(effective, w, crossings)}
              fill="none"
              stroke={
                candidate?.wireId === w.id
                  ? '#3478f6'
                  : highlighted(w.start.id)
                    ? '#f5a623'
                    : selected.includes(w.id)
                      ? '#3478f6'
                      : endColor(w.start.id)
              }
              strokeWidth={highlighted(w.start.id) ? 5 : 2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <polyline
              className="wire-hit"
              data-wire-id={w.id}
              points={pointsAttribute(wirePoints(effective, w))}
              fill="none"
              stroke="transparent"
              strokeWidth="32"
              strokeLinecap="round"
              strokeLinejoin="round"
              pointerEvents="stroke"
              vectorEffect="non-scaling-stroke"
              role="button"
              tabIndex={0}
              aria-label={`도선 ${w.id}`}
              onClick={(e) => {
                e.stopPropagation();
                if (!placement && !wiring.active)
                  props.onWire(w.id, snap(point(e.clientX, e.clientY)));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  const [a, b] = wirePoints(effective, w);
                  const p = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                  if (wiring.active)
                    wiring.activate({ kind: 'wire', wireId: w.id, point: p }, true);
                  else props.onWire(w.id, p);
                }
              }}
            />
          </g>
        ))}
        {effective.components.map((c) => {
          const isolated = Boolean(
            props.measurement?.disconnectSources && c.type === 'dc-voltage-source',
          );
          const select = selected.includes(c.id);
          const glow = props.highlightedElements?.includes(c.id);
          if (c.id === previewId) return null;
          const presentation = {
            label: c.label,
            value: componentValue(c),
            voltage: null,
            current: null,
          };
          const textLayout = componentNotationLayout(
            c,
            presentation.label,
            presentation.value,
            14 * labelScale,
          );
          const value = presentation.value;
          const valueFontSize=componentValueFontSize(effective.components,c,value,14*labelScale);
          return (
            <g
              key={c.id}
              className="circuit-element"
              data-component-id={c.id}
              data-source-isolated={isolated || undefined}
              data-selected={select}
              data-dragging={Boolean(activeDrag?.positions[c.id])}
              data-highlighted={Boolean(glow)}
              onMouseEnter={() => props.onHoverElement?.(c.id)}
              onMouseLeave={() => props.onHoverElement?.(null)}
            >
              <g
                role="button"
                tabIndex={0}
                aria-pressed={select}
                aria-label={`${c.label} ${componentValue(c)}`}
                className="component"
                onPointerDown={(e) => {
                  if (e.button !== 0 || capturedPointer.current !== null) return;
                  if (props.readOnly) {
                    e.stopPropagation();
                    props.onSelect(c.id);
                    return;
                  }
                  if (tool === 'path') {
                    e.stopPropagation();
                    props.onSelect(c.id);
                    return;
                  }
                  if (tool !== 'select' || placement) return;
                  e.stopPropagation();
                  const ids = selected.includes(c.id) ? selected : [c.id];
                  if (!selected.includes(c.id) || e.shiftKey) props.onSelect(c.id, e.shiftKey);
                  if (e.shiftKey) return;
                  const start = point(e.clientX, e.clientY);
                  dragSession.beginComponents(ids, start, e.pointerId);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    props.onSelect(c.id, e.shiftKey);
                  }
                }}
                onDoubleClick={() => {
                  if (!props.readOnly) editValue(c.id);
                }}
              >
                {/* Rotate with the symbol; keep an extra 12 screen pixels around it at every zoom. */}
                <rect
                  className="component-hit"
                  x="-44"
                  y="-24"
                  width="88"
                  height="48"
                  transform={`translate(${c.position.x},${c.position.y}) rotate(${c.rotation})`}
                  fill="transparent"
                  stroke="transparent"
                  strokeWidth="24"
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="all"
                />
                <g
                  className="component-lift"
                  pointerEvents="none"
                  opacity={isolated ? 0.28 : undefined}
                >
                  <g
                    className="component-ink"
                    transform={`translate(${c.position.x},${c.position.y}) rotate(${c.rotation})`}
                    stroke="#263548"
                    fill="white"
                    strokeWidth="2.5"
                    color="#263548"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    dangerouslySetInnerHTML={{
                      __html: symbolMarkup(c, { disconnectedSource: isolated }),
                    }}
                  />
                </g>
              </g>
              {props.currentArrows?.[c.id] !== undefined && props.currentArrows[c.id] !== 0 && (
                <g
                  transform={`translate(${c.position.x},${c.position.y}) rotate(${c.rotation})`}
                  stroke="#70828f"
                  strokeWidth={Math.min(4, 1 + Math.sqrt(Math.abs(props.currentArrows[c.id])))}
                  fill="none"
                  pointerEvents="none"
                >
                  <path
                    d={
                      props.currentArrows[c.id] > 0
                        ? 'M-20 24H20 M13 19L20 24 13 29'
                        : 'M20 24H-20 M-13 19L-20 24 -13 29'
                    }
                  />
                </g>
              )}
              <SvgNotation
                opacity={isolated ? 0.35 : undefined}
                x={textLayout.label.x}
                y={textLayout.label.y}
                textAnchor={textLayout.label.anchor}
                fontSize={14 * labelScale}
                fontWeight="650"
                fill="#344358"
                pointerEvents="none"
                symbol
                text={presentation.label}
              />
              <SvgNotation
                opacity={isolated ? 0.35 : undefined}
                data-value-id={c.id}
                className={props.readOnly ? 'component-value' : 'editable-value'}
                role={props.readOnly ? undefined : 'button'}
                tabIndex={props.readOnly ? undefined : 0}
                aria-label={props.readOnly ? undefined : `${c.label} 값 편집`}
                x={textLayout.value.x}
                y={textLayout.value.y}
                textAnchor={textLayout.value.anchor}
                fontSize={valueFontSize}
                fill="#52647b"
                onClick={() => {
                  if (!props.readOnly && !placement) editValue(c.id);
                }}
                onKeyDown={(e) => {
                  if (!props.readOnly && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); editValue(c.id); }
                }}
                text={value}
              />
              {[
                presentation.voltage && `U = ${presentation.voltage}`,
                presentation.current && `I = ${presentation.current}`,
              ]
                .filter(Boolean)
                .map((text, i) => (
                  <text
                    key={i}
                    x={c.position.x + (c.rotation % 180 ? 32 * labelScale : 0)}
                    y={c.position.y + (c.rotation % 180 ? 38 + i * 22 : 61 + i * 22) * labelScale}
                    textAnchor={c.rotation % 180 ? 'start' : 'middle'}
                    fontSize={12 * labelScale}
                    fill="#506a88"
                    pointerEvents="none"
                  >
                    {text}
                  </text>
                ))}
              {c.terminals.map((t, i) => {
                const p = terminalPosition(c, i);
                return (
                  <g
                    key={t.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`단자 ${t.id}`}
                    data-endpoint-id={t.id}
                    data-endpoint-kind="terminal"
                    className="terminal"
                    data-active={wiring.hint?.kind === 'endpoint' && wiring.hint.ref.id === t.id}
                    onFocus={() => {
                      if (wiring.active)
                        wiring.focusTarget(
                          endpointTarget(document, { kind: 'terminal', id: t.id }),
                        );
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      chooseEndpoint({ kind: 'terminal', id: t.id });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        chooseEndpoint({ kind: 'terminal', id: t.id });
                      }
                    }}
                  >
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r="1"
                      fill="transparent"
                      stroke="transparent"
                      strokeWidth="44"
                      vectorEffect="non-scaling-stroke"
                    />
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={highlighted(t.id) || isWireStart(t.id) ? 6 : 4}
                      fill={isWireStart(t.id) ? '#3478f6' : endColor(t.id)}
                      stroke="white"
                      strokeWidth="1.2"
                    />
                    <title>{props.endpointLabels?.[t.id]}</title>
                  </g>
                );
              })}
            </g>
          );
        })}
        {effective.junctions.map((j) => (
          <g
            key={j.id}
            role="button"
            tabIndex={0}
            aria-label={`분기점 ${j.id}`}
            data-endpoint-id={j.id}
            data-endpoint-kind="junction"
            className="terminal"
            data-active={wiring.hint?.kind === 'endpoint' && wiring.hint.ref.id === j.id}
            onFocus={() => {
              if (wiring.active)
                wiring.focusTarget(endpointTarget(document, { kind: 'junction', id: j.id }));
            }}
            onClick={(e) => {
              e.stopPropagation();
              chooseEndpoint({ kind: 'junction', id: j.id });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                chooseEndpoint({ kind: 'junction', id: j.id });
              }
            }}
          >
            <circle
              cx={j.position.x}
              cy={j.position.y}
              r="1"
              fill="transparent"
              stroke="transparent"
              strokeWidth="44"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={j.position.x}
              cy={j.position.y}
              r="5"
              fill={highlighted(j.id) ? '#f5a623' : endColor(j.id)}
            />
            <title>{props.endpointLabels?.[j.id]}</title>
          </g>
        ))}
        {document.referenceNode &&
          (() => {
            const p = endpointPosition(effective, document.referenceNode!);
            return (
              <g
                transform={`translate(${p.x},${p.y + 9})`}
                pointerEvents="none"
                stroke="#8694a5"
                strokeWidth="1.5"
              >
                <path d="M0 0V10 M-10 10H10 M-6 14H6 M-2 18H2" />
                <text
                  x={16 * labelScale}
                  y={16 * labelScale}
                  fill="#6a7c92"
                  stroke="none"
                  fontSize={11 * labelScale}
                >
                  0 V
                </text>
              </g>
            );
          })()}

        {callouts.map((label) => (
          <g key={label.id} pointerEvents="none">
            <path
              d={`M${label.anchor.x} ${label.anchor.y}L${label.x + label.w / 2} ${label.y + label.h}`}
              fill="none"
              stroke={endColor(label.id)}
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <rect
              x={label.x}
              y={label.y}
              width={label.w}
              height={label.h}
              rx={5 * labelScale}
              fill="white"
              stroke={endColor(label.id)}
            />
            <text
              x={label.x + label.w / 2}
              y={label.y + 15 * labelScale}
              textAnchor="middle"
              fontSize={12 * labelScale}
              fill={endColor(label.id)}
            >
              {label.text}
            </text>
          </g>
        ))}
        {props.measurement && (
          <MeasurementLayer
            {...props.measurement}
            cancelKey={measurementCancel}
            document={document}
            scale={drawingScale}
            bounds={view}
            point={point}
          />
        )}
        {wireOrigin && (
          <polyline
            data-wire-preview
            points={pointsAttribute(wiring.previewPath)}
            fill="none"
            stroke="#174895"
            strokeWidth="2.5"
            strokeDasharray="7 5"
            pointerEvents="none"
          />
        )}
        {wiring.active && !wiring.start && tool === 'select' && !activeDrag && (
          <WireSegmentHandles
            document={document}
            selected={selected}
            scale={drawingScale}
            dragging={
              activeWireDrag ? wireDragCommand(activeWireDrag, activeWireDrag.current) : null
            }
            onStart={(wireId, segment, horizontal, e) => {
              if (capturedPointer.current !== null) return;
              wiring.clearHint();
              const start = point(e.clientX, e.clientY);
              dragSession.beginWire(wireId, segment, horizontal, start, e.pointerId);
            }}
            onStep={(wireId, segment, offset) =>
              props.onWiringCommit?.([{ type: 'MoveWireSegment', wireId, segment, offset }])
            }
          />
        )}
        <WiringMarks wiring={wiring} scale={drawingScale} bounds={view} />
        {wiring.active &&
          !wiring.start &&
          crossings.map((c) => (
            <g
              key={c.point.x + ':' + c.point.y}
              role="button"
              tabIndex={0}
              aria-label={'교차 ' + c.horizontalId + ' ' + c.verticalId + ' 연결 옵션'}
              onFocus={() => wiring.focusTarget({ kind: 'crossing', crossing: c, point: c.point })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  wiring.activate({ kind: 'crossing', crossing: c, point: c.point }, true);
                }
              }}
            >
              <circle cx={c.point.x} cy={c.point.y} r={22 / drawingScale} fill="transparent" />
            </g>
          ))}
        {previewComponent && (
          <g opacity=".6" pointerEvents="none" aria-label="부품 배치 미리보기">
            <g
              transform={`translate(${previewComponent.position.x},${previewComponent.position.y}) rotate(${previewComponent.rotation})`}
              stroke="#245cb1"
              fill="white"
              color="#245cb1"
              strokeWidth="2.5"
              dangerouslySetInnerHTML={{ __html: symbolMarkup(previewComponent) }}
            />
            {previewComponent.terminals.map((t, i) => {
              const p = terminalPosition(previewComponent, i);
              return <circle key={t.id} cx={p.x} cy={p.y} r="4" fill="#245cb1" />;
            })}
          </g>
        )}
        {placement && placementFailure && <PlacementFailure key={placementFailure.attempt} point={placementFailure.point} scale={drawingScale}/>}
      </svg>
      {componentChoices.length > 0 && (
        <div className="touch-choice-list" aria-label="겹친 부품 선택">
          <span>부품을 선택한 뒤 이동·이름·값을 조절하세요</span>
          {componentChoices.map((id) => (
            <button
              key={id}
              onClick={() => {
                props.onSelect(id);
                setComponentChoices([]);
              }}
            >
              {document.components.find((c) => c.id === id)?.label} · {id}
            </button>
          ))}
          <button onClick={() => setComponentChoices([])}>취소</button>
        </div>
      )}
      {placement && (
        <div className="placement-status" role="status">
          <span>
            {placementMessage ||
              (insertionPreview?.ok
                    ? '양쪽 연결을 확인하고 삽입하세요'
                    : candidates.length > 1 && candidates.some(c => !c.reason)
                      ? '삽입할 도선을 선택하세요'
                        : '놓을 곳을 누르거나 길게 눌러 옮기세요')}
          </span>
          {candidates.length > 1 && candidates.some(c => !c.reason) &&
            candidates.map((c) => (
              <button
                key={`${c.wireId}:${c.segment}`}
                aria-pressed={insertionWire === `${c.wireId}:${c.segment}`}
                onClick={() => {
                  setInsertionWire(`${c.wireId}:${c.segment}`);
                  setPlacementMessage('');
                }}
              >
                {c.wireId} · 구간 {c.segment + 1}
              </button>
            ))}
          <button
            onClick={() => placeAt(placement, snap(pointer), true)}
          >
            {candidates.length ? '삽입' : '여기에 배치'}
          </button>
          <button onClick={props.onCancel}>취소</button>
        </div>
      )}
      {tapMove && drag && (
        <div className="placement-status">
          <span>옮길 곳을 누르고 배선을 확인하세요</span>
          <button
            onClick={() => {
              const positions = dragPositions(drag, drag.current);
              if (Object.keys(positions).length) props.onMove(positions);
              cancelGesture();
            }}
          >
            놓기
          </button>
          <button onClick={cancelGesture}>취소</button>
        </div>
      )}
      <WiringOverlay
        wiring={wiring}
        screenPoint={screenPoint}
        width={viewport.width}
        height={viewport.height}
        cancel={cancelWiring}
      />
      {editingComponent && (
        <InlineComponentEditor
          key={editingComponent.id}
          component={editingComponent}
          point={editorPoint}
          viewport={viewport}
          drawingScale={drawingScale}
          labelScale={labelScale}
          onCommit={props.onCommitComponent}
          onToggleSwitch={()=>{const applied=props.onSwitch(editingComponent.id);keepSwitchEditor.current=applied===true;return applied!==false;}}
          onClose={closeEditor}
        />
      )}
      {!props.readOnly &&
        !placement &&
        !editingId &&
        !tapMove &&
        props.onAction &&
        selectedComponent && (
          <div
            className="canvas-selection-tools"
            style={{
              left: Math.max(8, Math.min(viewport.width - 320, selectionPoint.x - 160)),
              right: 'auto',
              top: Math.max(10, selectionPoint.y - Math.max(130, 110 * drawingScale)),
            }}
            aria-label="선택 부품 도구"
          >
            <button onClick={() => editValue(selected[0], true)}>이름·값</button>
            <button
              onClick={() => {
                beginDrag(selectedComponent.id, selectedComponent.position, -1);
                setTapMove(true);
              }}
            >
              이동
            </button>
            <button onClick={() => props.onAction?.('rotate')}>회전</button>
            <button onClick={() => props.onAction?.('copy')}>복사</button>
            <button onClick={() => props.onAction?.('delete')}>삭제</button>
          </div>
        )}
      <span className="wiring-sr-only" role="status">
        {activeDrag
          ? '부품 이동 중'
          : touchNavigation.state === 'panning'
            ? '화면 이동 중'
            : touchNavigation.state === 'pinching'
              ? '화면 확대·이동 중'
              : ''}
      </span>
      <div className="canvas-bottom-bar">
        {props.viewLabel}
        <div className="canvas-view-tools">
          <button onClick={() => zoom(0.8)} aria-label="확대">
            ＋
          </button>
          <span>{Math.round(100000 / view.width)}%</span>
          <button onClick={() => zoom(1.25)} aria-label="축소">
            −
          </button>
          <button onClick={() => setView(documentBounds(document, 110))}>전체 보기</button>
        </div>
      </div>
    </div>
  );
}
