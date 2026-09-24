import { useEffect, useRef, type RefObject } from 'react';

type View = { x: number; y: number; width: number; height: number };

/** Keep the circuit point under the pointer fixed, including SVG letterboxing. */
export function useCanvasWheelZoom(
  svg: RefObject<SVGSVGElement | null>,
  view: View,
  setView: (view: View) => void,
  cancel: () => void,
  minWidth: number,
  maxWidth: number,
) {
  const latest = useRef({ view, setView, cancel, minWidth, maxWidth });
  latest.current = { view, setView, cancel, minWidth, maxWidth };
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      const matrix = element.getScreenCTM();
      if (!matrix || !event.deltaY) return;
      // React's delegated wheel listener is passive; use a local listener to
      // prevent page scrolling/browser zoom only while over this canvas.
      event.preventDefault();
      const current = latest.current;
      const v = current.view;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      const delta = Math.max(-100, Math.min(100, event.deltaY * unit));
      const width = Math.max(
        current.minWidth,
        Math.min(current.maxWidth, v.width * Math.exp(delta * 0.0015)),
      );
      const factor = width / v.width;
      const next = {
        x: point.x + (v.x - point.x) * factor,
        y: point.y + (v.y - point.y) * factor,
        width,
        height: v.height * factor,
      };
      current.cancel();
      current.view = next;
      current.setView(next);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [svg]);
}
