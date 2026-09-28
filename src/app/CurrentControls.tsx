import { useMemo, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import type { CircuitDocument } from '../domain';
import { endpointName } from '../component-library';
import type { CurrentDisplay, CurrentModel } from '../visualization';
import { formatQuantity } from '../quantity';
import { Notation } from './Notation';
import './current-controls.css';

export function useCurrentDisplay(model: CurrentModel) {
  const [paused, setPaused] = useState(false);
  const [widthScale, setWidthScale] = useState(1);
  const display: CurrentDisplay = useMemo(
    () => ({ model, scaleAmperes: model.maxMagnitude || 1, widthScale, paused }),
    [model, widthScale, paused],
  );
  return { display, setPaused, setWidthScale };
}

export function CurrentControls({
  paused,
  onPause,
}: {
  paused: boolean;
  onPause: (paused: boolean) => void;
}) {
  const label = paused ? '흐름 재생' : '흐름 일시 정지';
  return (
    <button
      type="button"
      className="current-pause"
      aria-label={label}
      title={label}
      aria-pressed={paused}
      onClick={() => onPause(!paused)}
    >
      {paused ? <Play size={16} /> : <Pause size={16} />}
    </button>
  );
}

/** Detailed values share the existing settings panel, leaving the canvas uncluttered. */
export function CurrentSettings({
  document,
  display,
  selectedId,
  onWidthScale,
}: {
  document: CircuitDocument;
  display: CurrentDisplay;
  selectedId?: string;
  onWidthScale: (value: number) => void;
}) {
  const selected = display.model.samples.find((s) => s.id === selectedId),
    value = selected?.value;
  const direction =
    value?.status === 'known' && value.amperes !== 0
      ? (value.amperes > 0 ? [value.from, value.to] : [value.to, value.from]).map((ref) =>
          endpointName(document, ref.id),
        )
      : null;
  return (
    <div className="current-settings">
      <label className="field-label">
        전류 두께 ×{Number(display.widthScale.toFixed(2))}
        <input
          aria-label="전류 두께 배율"
          type="range"
          min="0.25"
          max="3"
          step="0.05"
          value={display.widthScale}
          onChange={(e) => onWidthScale(Number(e.target.value))}
        />
      </label>
      <div className="current-readout" aria-live="polite">
        {!selected ? (
          <span>도선이나 부품을 선택하면 전류값과 방향을 확인할 수 있습니다.</span>
        ) : (
          <>
            <strong>
              <Notation
                symbol
                text={document.components.find((c) => c.id === selected.id)?.label ?? selected.id}
              />
            </strong>
            <span>
              {value?.status === 'known' ? (
                <Notation text={formatQuantity(Math.abs(value.amperes), 'A')} />
              ) : value?.status === 'undefined' ? (
                '전류 미정 · 이상적 도선 고리'
              ) : (
                '전류를 계산할 수 없음'
              )}
            </span>
            {direction && (
              <span className="current-direction">
                <Notation symbol text={direction[0]} /> → <Notation symbol text={direction[1]} />
              </span>
            )}
            {value?.status === 'known' && value.amperes === 0 && <span>흐르는 전류 없음</span>}
          </>
        )}
      </div>
    </div>
  );
}
