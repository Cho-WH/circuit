import { CurrentGlyph, ProbeGlyph } from './measurement-tools';
import { SelectionButton } from './SelectionButton';

export type MeasurementKind = 'voltage' | 'current' | 'resistance';
export type AnalysisPanel = 'records' | 'path' | null;
export const measurementLabels: Record<MeasurementKind, string> = {
  voltage: '전압 탐침', current: '전류 센서', resistance: '등가저항',
};

export function AnalysisTools({
  kind,
  onChoose,
  needsIsolation,
  onIsolate,
  threeDimensional,
}: {
  kind: MeasurementKind | null;
  onChoose: (kind: MeasurementKind | null) => void;
  needsIsolation: boolean;
  onIsolate: () => void;
  threeDimensional: boolean;
}) {
  return (
    <>
      <div className="section-heading">
        <h2>측정 도구</h2>
      </div>
      <div className="component-grid analysis-tools" aria-label="분석 도구">
        {(['voltage', 'current', 'resistance'] as const).map((value) => (
          <SelectionButton
            key={value}
            className="component-tile"
            selected={kind === value}
            onClick={() => onChoose(kind === value && !threeDimensional ? null : value)}
          >
            <span className="tile-symbol">
              {value === 'current' ? (
                <svg width="36" height="32" viewBox="-18 -39 36 54" aria-hidden="true">
                  <CurrentGlyph />
                </svg>
              ) : value === 'voltage' ? (
                <svg width="48" height="32" viewBox="-25 -46 50 50" aria-hidden="true">
                  <g transform="translate(-10)">
                    <ProbeGlyph />
                  </g>
                  <g transform="translate(10)">
                    <ProbeGlyph color="black" />
                  </g>
                </svg>
              ) : (
                <span className="resistance-symbol" aria-hidden="true">
                  Ω
                </span>
              )}
            </span>
            <span>
              {measurementLabels[value]}
            </span>
          </SelectionButton>
        ))}
      </div>
      {needsIsolation && (
        <div className="isolation-prompt" role="status">
          <p>등가저항은 전지를 분리하고 측정해요.</p>
          <button className="primary" onClick={onIsolate}>
            전지 분리하고 측정
          </button>
        </div>
      )}
      {threeDimensional && kind !== 'voltage' && (
        <p className="analysis-tool-hint">측정 도구를 고르면 2D로 전환해요.</p>
      )}
    </>
  );
}
