import { snapGridPoint, snapGridValue } from '../wire-geometry';
import { useMemo, useRef, useState, type RefObject } from 'react';
import type { CircuitDocument, ComponentType, Point } from '../domain';
import { previewCommand, type Command } from '../editor';

type View = { x: number; y: number; width: number; height: number };
interface DragBase {
  start: Point;
  current: Point;
  pointerId: number;
  document: CircuitDocument;
}
interface ComponentDrag extends DragBase {
  positions: Record<string, Point>;
}
interface WireDrag extends DragBase {
  wireId: string;
  segment: number;
  horizontal: boolean;
}

export const snapCanvasPoint = snapGridPoint;

export function dragPositions(session: ComponentDrag, current: Point): Record<string, Point> {
  const delta = snapCanvasPoint({ x: current.x - session.start.x, y: current.y - session.start.y });
  if (delta.x === 0 && delta.y === 0) return {};
  return Object.fromEntries(
    Object.entries(session.positions).map(([id, position]) => [
      id,
      {
        x: position.x + delta.x,
        y: position.y + delta.y,
      },
    ]),
  );
}

export function wireDragCommand(
  session: WireDrag,
  current: Point,
): Command & { type: 'MoveWireSegment' } {
  const delta = session.horizontal ? current.y - session.start.y : current.x - session.start.x;
  return {
    type: 'MoveWireSegment',
    wireId: session.wireId,
    segment: session.segment,
    offset: snapGridValue(delta),
  };
}

/** A gesture retains its starting document; previews and release use that same command. */
export function useCanvasDragSession(
  document: CircuitDocument,
  tool: string,
  placement: ComponentType | null,
  readOnly: boolean | undefined,
  svg: RefObject<SVGSVGElement | null>,
) {
  const [drag, setDrag] = useState<ComponentDrag | null>(null);
  const [wireDrag, setWireDrag] = useState<WireDrag | null>(null);
  const [pan, setPan] = useState<{ x: number; y: number; view: View } | null>(null);
  const capturedPointer = useRef<number | null>(null);
  const enabled = tool === 'select' && !placement && !readOnly;
  const activeDrag = enabled && drag?.document === document ? drag : null;
  const activeWireDrag = enabled && wireDrag?.document === document ? wireDrag : null;

  function capture(pointerId: number) {
    if (pointerId < 0) return; // Tap-to-move has no captured pointer.
    capturedPointer.current = pointerId;
    svg.current?.setPointerCapture(pointerId);
  }

  function cancel() {
    setDrag(null);
    setWireDrag(null);
    setPan(null);
    const pointerId = capturedPointer.current;
    capturedPointer.current = null;
    if (pointerId !== null && svg.current?.hasPointerCapture(pointerId))
      svg.current.releasePointerCapture(pointerId);
  }

  const movedDocument = useMemo(() => {
    if (activeWireDrag) {
      const result = previewCommand(
        document,
        wireDragCommand(activeWireDrag, activeWireDrag.current),
      );
      return result.ok ? result.document : document;
    }
    if (!activeDrag) return document;
    const positions = dragPositions(activeDrag, activeDrag.current);
    if (!Object.keys(positions).length) return document;
    const result = previewCommand(document, { type: 'MoveComponents', positions });
    return result.ok ? result.document : document;
  }, [document, activeDrag, activeWireDrag]);

  return {
    drag,
    activeDrag,
    activeWireDrag,
    pan,
    capturedPointer,
    movedDocument,
    cancel,
    beginComponents(ids: string[], start: Point, pointerId: number) {
      setDrag({
        start,
        current: start,
        positions: Object.fromEntries(
          document.components
            .filter((component) => ids.includes(component.id))
            .map((component) => [component.id, component.position]),
        ),
        pointerId,
        document,
      });
      capture(pointerId);
    },
    beginWire(
      wireId: string,
      segment: number,
      horizontal: boolean,
      start: Point,
      pointerId: number,
    ) {
      setWireDrag({ start, current: start, wireId, segment, horizontal, pointerId, document });
      capture(pointerId);
    },
    beginPan(x: number, y: number, view: View, pointerId: number) {
      setPan({ x, y, view });
      capture(pointerId);
    },
    move(pointerId: number, current: Point) {
      if (activeDrag?.pointerId === pointerId) setDrag({ ...activeDrag, current });
      if (activeWireDrag?.pointerId === pointerId) setWireDrag({ ...activeWireDrag, current });
    },
    moveTo(current: Point) {
      if (drag) setDrag({ ...drag, current });
    },
  };
}
