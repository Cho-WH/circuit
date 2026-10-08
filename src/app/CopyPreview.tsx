import type { PastePayload } from '../editor';
import {
  componentNotationLayout,
  componentValue,
  componentValueFontSize,
  pointsAttribute,
  symbolMarkup,
  terminalPosition,
  wirePoints,
} from '../component-library';
import { payloadDocument } from './copy-placement';
import { SvgNotation } from './Notation';

export function CopyPreview({
  payload,
  labelScale,
}: {
  payload: PastePayload;
  labelScale: number;
}) {
  const doc = payloadDocument(payload);
  return (
    <g
      className="copy-preview"
      opacity=".5"
      pointerEvents="none"
      aria-label="복사 배치 미리보기"
      stroke="currentColor"
      fill="none"
      strokeWidth="2.5"
    >
      {payload.wires.map((w) => (
        <polyline key={w.id} points={pointsAttribute(wirePoints(doc, w))} />
      ))}
      {payload.junctions.map((j) => (
        <circle key={j.id} cx={j.position.x} cy={j.position.y} r="4" fill="currentColor" />
      ))}
      {payload.components.map((c) => {
        const layout = componentNotationLayout(c, c.label, componentValue(c), 14 * labelScale);
        return (
          <g key={c.id}>
            <g
              transform={`translate(${c.position.x},${c.position.y}) rotate(${c.rotation})`}
              fill="white"
              dangerouslySetInnerHTML={{ __html: symbolMarkup(c) }}
            />
            {c.terminals.map((t, i) => {
              const p = terminalPosition(c, i);
              return <circle key={t.id} cx={p.x} cy={p.y} r="4" fill="currentColor" />;
            })}
            <SvgNotation
              text={c.label}
              x={layout.label.x}
              y={layout.label.y}
              textAnchor={layout.label.anchor}
              fontSize={14 * labelScale}
              fill="currentColor"
              stroke="none"
              symbol
            />
            <SvgNotation
              text={componentValue(c)}
              x={layout.value.x}
              y={layout.value.y}
              textAnchor={layout.value.anchor}
              fontSize={componentValueFontSize(
                payload.components,
                c,
                componentValue(c),
                14 * labelScale,
              )}
              fill="currentColor"
              stroke="none"
            />
          </g>
        );
      })}
    </g>
  );
}
