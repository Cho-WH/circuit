import type { PointerEvent } from 'react';
import type { CircuitDocument, Point } from '../../domain';
import { wirePoints } from '../../component-library';
import { orthogonalWirePoints } from '../../wire-geometry';

/** Separate square handles keep segment editing distinct from clicking a wire to branch. */
export function WireSegmentHandles(props: {
  document: CircuitDocument; selected: string[]; scale: number;
  dragging?: { wireId: string; segment: number; offset: number } | null;
  onStart: (wireId: string, segment: number, horizontal: boolean, event: PointerEvent<SVGGElement>) => void;
  onStep: (wireId: string, segment: number, offset: number) => void;
}) {
  return <g className="wire-segment-handles">
    {props.document.wires.filter(w => props.selected.includes(w.id)).flatMap(w => {
      const points = orthogonalWirePoints(wirePoints(props.document, w));
      return points.slice(1).flatMap((b, segment) => {
        const a = points[segment], horizontal = a.y === b.y;
        if (props.dragging && (props.dragging.wireId !== w.id || props.dragging.segment !== segment)) return [];
        const offset = props.dragging?.offset ?? 0;
        const p: Point = { x: (a.x + b.x) / 2 + (horizontal ? 0 : offset), y: (a.y + b.y) / 2 + (horizontal ? offset : 0) };
        const label = `도선 ${w.id} ${segment + 1}번 구간 ${horizontal ? '위아래' : '좌우'} 이동`;
        return [<g key={`${w.id}:${segment}`} data-wire-handle role="button" tabIndex={0} aria-label={label}
          style={{ cursor: horizontal ? 'ns-resize' : 'ew-resize' }}
          onPointerDown={e => { if (e.button === 0) { e.preventDefault(); e.stopPropagation(); props.onStart(w.id, segment, horizontal, e); } }}
          onClick={e => e.stopPropagation()}
          onKeyDown={e => {
            if (e.key === 'Escape' || e.key === 'Tab') return;
            e.stopPropagation();
            const offset = horizontal ? (e.key === 'ArrowUp' ? -20 : e.key === 'ArrowDown' ? 20 : 0) : (e.key === 'ArrowLeft' ? -20 : e.key === 'ArrowRight' ? 20 : 0);
            if (offset) { e.preventDefault(); props.onStep(w.id, segment, offset); }
          }}>
          <title>{label} · 끌기 또는 방향키</title>
          <rect x={p.x-22/props.scale} y={p.y-22/props.scale} width={44/props.scale} height={44/props.scale} fill="transparent"/>
          <rect className="wire-segment-grip" x={p.x-5/props.scale} y={p.y-5/props.scale} width={10/props.scale} height={10/props.scale} rx={2/props.scale} fill="white" stroke="#3478f6" strokeWidth={2/props.scale}/>
        </g>];
      });
    })}
  </g>;
}
