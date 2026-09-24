import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Point } from '../domain';

type View = { x: number; y: number; width: number; height: number };
/** Owns touch navigation only. Document edits remain in the canvas/editor handlers. */
export function useTouchNavigation(view: View, setView: (v: View) => void, scale: number, cancelDrag: () => void) {
  const pointers = useRef(new Map<number, Point>());
  const session = useRef<{ origin: Point; view: View; scale: number; pan: boolean; moved: boolean; pinch?: { center: Point; distance: number; anchor: Point } } | null>(null);
  const suppressClick = useRef(false);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<'idle'|'pressing'|'dragging'|'panning'|'pinching'>('idle');
  function clearHold() { if (hold.current !== null) clearTimeout(hold.current); hold.current = null; }
  function reset() { clearHold(); if (pointers.current.size) suppressClick.current = true; pointers.current.clear(); session.current = null; setState('idle'); }
  useEffect(() => { window.addEventListener('blur', reset); return () => { clearHold(); window.removeEventListener('blur', reset); }; }, []);
  const point = (e: ReactPointerEvent) => ({ x: e.clientX, y: e.clientY });
  function down(e: ReactPointerEvent<SVGSVGElement>, pan: boolean, onHold?: () => void) {
    if (e.pointerType !== 'touch') { suppressClick.current = false; return false; }
    pointers.current.set(e.pointerId, point(e));
    if (pointers.current.size === 1) {
      clearHold(); suppressClick.current = false; session.current = { origin: point(e), view, scale, pan, moved: false }; setState('pressing');
      if (onHold) hold.current = setTimeout(() => {
        hold.current = null;
        if (!session.current || session.current.moved || pointers.current.size !== 1) return;
        session.current.pan = false; suppressClick.current = true; setState('dragging'); onHold();
      }, 450);
    }
    if (pointers.current.size === 2) {
      clearHold(); setState('pinching');
      const [a, b] = [...pointers.current.values()], center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const bounds = e.currentTarget.getBoundingClientRect();
      const left = bounds.left + (bounds.width - view.width * scale) / 2, top = bounds.top + (bounds.height - view.height * scale) / 2;
      session.current = { origin: center, view, scale, pan: true, moved: true, pinch: { center, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), anchor: { x: view.x + (center.x - left) / scale, y: view.y + (center.y - top) / scale } } };
      suppressClick.current = true;
      cancelDrag();
    }
    // Capture only navigation gestures. Selected-component drags use the existing drag session.
    if (session.current?.pan) e.currentTarget.setPointerCapture(e.pointerId);
    return Boolean(session.current?.pan);
  }
  function move(e: ReactPointerEvent<SVGSVGElement>) {
    if (!pointers.current.has(e.pointerId) || !session.current) return false;
    pointers.current.set(e.pointerId, point(e));
    const s = session.current;
    if (s.pinch && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()], center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const width = Math.max(200, Math.min(5000, s.view.width * s.pinch.distance / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))));
      const height = width * s.view.height / s.view.width, bounds = e.currentTarget.getBoundingClientRect();
      const nextScale = Math.min(bounds.width / width, bounds.height / height);
      setView({ width, height, x: s.pinch.anchor.x - (center.x - bounds.left - (bounds.width - width * nextScale) / 2) / nextScale, y: s.pinch.anchor.y - (center.y - bounds.top - (bounds.height - height * nextScale) / 2) / nextScale });
      return true;
    }
    if (s.pinch) return true; // A remaining finger after a pinch must not place or connect anything.
    if (Math.hypot(e.clientX - s.origin.x, e.clientY - s.origin.y) > 10) { clearHold(); s.moved = true; suppressClick.current = true; setState(s.pan ? 'panning' : 'dragging'); }
    if (s.pan && s.moved) setView({ ...s.view, x: s.view.x - (e.clientX - s.origin.x) / s.scale, y: s.view.y - (e.clientY - s.origin.y) / s.scale });
    return s.pan;
  }
  function up(e: ReactPointerEvent<SVGSVGElement>, canceled = false) {
    if (!pointers.current.has(e.pointerId)) return false;
    const handled = Boolean(session.current?.pan);
    if(session.current&&Math.hypot(e.clientX-session.current.origin.x,e.clientY-session.current.origin.y)>10)suppressClick.current=true;
    clearHold();
    if (canceled) { suppressClick.current = true; cancelDrag(); if (session.current) session.current.pan = true; }
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) { session.current = null; setState('idle'); }
    return handled;
  }
  // Keep suppression through every release/click of a multi-touch gesture. A new down resets it.
  function consumeClick() { return suppressClick.current; }
  // Releasing an edit capture while entering a pinch is intentional; retain both navigation pointers.
  function lost(e: ReactPointerEvent<SVGSVGElement>) { if (!session.current?.pinch) up(e, true); }
  return { down, move, up, lost, consumeClick, suppress: () => {suppressClick.current=true;}, reset, state };
}
