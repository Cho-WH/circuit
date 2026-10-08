import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Point } from '../domain';

type Marquee = { start: Point; end: Point; pointerId: number; additive: boolean };

/** Only the visual rectangle updates per frame; selection is committed once on release. */
export function useMarqueeSelection(svg: RefObject<SVGSVGElement | null>) {
  const session = useRef<Marquee | null>(null);
  const frame = useRef<number | null>(null);
  const [rectangle, setRectangle] = useState<Marquee | null>(null);
  function cancel() {
    const id = session.current?.pointerId;
    session.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setRectangle(null);
    if (id !== undefined && svg.current?.hasPointerCapture(id))
      svg.current.releasePointerCapture(id);
  }
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  return {
    rectangle,
    begin(start: Point, pointerId: number, additive: boolean) {
      session.current = { start, end: start, pointerId, additive };
      setRectangle(session.current);
      svg.current?.setPointerCapture(pointerId);
    },
    move(pointerId: number, end: Point) {
      if (session.current?.pointerId !== pointerId) return false;
      session.current = { ...session.current, end };
      if (frame.current === null)
        frame.current = requestAnimationFrame(() => {
          frame.current = null;
          setRectangle(session.current);
        });
      return true;
    },
    finish(pointerId: number, end: Point) {
      if (session.current?.pointerId !== pointerId) return null;
      const result = { ...session.current, end };
      cancel();
      return result;
    },
    cancel,
  };
}
