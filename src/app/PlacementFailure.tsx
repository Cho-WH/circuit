import { useEffect, useState } from 'react';
import type { Point } from '../domain';

/** Ephemeral feedback only; a rejected placement keeps its draft and never changes the document. */
export function PlacementFailure({ point, scale }: { point: Point; scale: number }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 320);
    return () => window.clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return <g className="placement-failure" role="img" aria-label="배치할 수 없음" pointerEvents="none"
    transform={`translate(${point.x},${point.y}) scale(${1 / scale})`}>
    <circle r={19} fill="#fff4f0" stroke="currentColor" strokeWidth={2}/>
    <path d="M-6-6L6 6M6-6L-6 6" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"/>
  </g>;
}
