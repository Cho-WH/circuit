// @refresh reset
// Recreate imperative overlay closures when this projection adapter changes.
import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { CircuitDocument } from '../domain';
import { buildCurrentPaths, type CurrentDisplay } from '../visualization';
import { createCurrentOverlay, type CurrentOverlay } from '../current-view';

export function CanvasCurrentLayer({
  document,
  source,
  display,
  view,
  colors,
}: {
  document: CircuitDocument;
  source: RefObject<SVGSVGElement | null>;
  display: CurrentDisplay;
  view: { x: number; y: number; width: number; height: number };
  colors?: Record<string, string>;
}) {
  const host = useRef<HTMLDivElement>(null),
    renderer = useRef<CurrentOverlay | null>(null);
  const latest = useRef({ document, display, colors });
  latest.current = { document, display, colors };
  const project = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    if (!host.current || !source.current) return;
    const target = host.current,
      svg = source.current;
    renderer.current = createCurrentOverlay(target);
    project.current = () => {
      const matrix = svg.getScreenCTM?.(),
        rect = target.getBoundingClientRect();
      if (!matrix) return;
      const { document, display, colors } = latest.current;
      const paths = buildCurrentPaths(document, display.model, undefined, colors).map((path) => ({
        path,
        points: path.points.map((p) => ({
          x: matrix.a * p.x + matrix.c * p.y + matrix.e - rect.left,
          y: matrix.b * p.x + matrix.d * p.y + matrix.f - rect.top,
        })),
      }));
      renderer.current?.update(paths, { width: rect.width, height: rect.height }, display);
    };
    const observer = new ResizeObserver(() => project.current());
    observer.observe(target);
    project.current();
    return () => {
      observer.disconnect();
      renderer.current?.dispose();
      renderer.current = null;
    };
  }, [source]);
  useLayoutEffect(() => project.current(), [document, display, view, colors]);
  return <div className="current-flow-host" ref={host} />;
}
