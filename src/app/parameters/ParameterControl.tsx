import { useEffect, useState } from 'react';
import { PlaybackButton } from '../PlaybackButton';
import type { ComponentInstance } from '../../domain';
import { componentValueInput, type AdjustableParameter } from '../../component-library';
import { formatQuantity } from '../../quantity';
import { parseComponentValue } from '../component-value';
import { Notation } from '../Notation';
import { useLiveValue } from './useLiveValue';
import './parameters.css';

export function ParameterControl({
  component,
  parameter,
  onChange,
  disabled,
  onAdjustingChange,
}: {
  component: ComponentInstance;
  parameter: AdjustableParameter;
  disabled: boolean;
  onChange: (value: number, group?: object, fraction?: string) => boolean;
  onAdjustingChange?: (id: string, adjusting: boolean) => void;
}) {
  const { min, max, value, unit, label } = parameter;
  const live = useLiveValue(value, min, max, onChange);
  useEffect(() => {
    onAdjustingChange?.(component.id, live.adjusting);
    return () => onAdjustingChange?.(component.id, false);
  }, [component.id, live.adjusting, onAdjustingChange]);
  const [draft, setDraft] = useState(componentValueInput(component));
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!editing) setDraft(componentValueInput(component));
  }, [component, editing]);
  function commit() {
    const parsed = parseComponentValue(component, draft);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    live.finish();
    if (!onChange(parsed.value, undefined, parsed.fraction)) setError('값을 바꿀 수 없습니다.');
    else {
      setError('');
      setEditing(false);
    }
  }
  return (
    <fieldset
      className="parameter-control"
      disabled={disabled}
      aria-label={`${component.label} 조절`}
    >
      <div className="parameter-value-row">
        <label htmlFor={`parameter-${component.id}`}>{label}</label>
        <div className="unit-input">
          <input
            id={`parameter-${component.id}`}
            aria-label={`${component.label} ${label}`}
            value={editing ? draft : live.running ? String(live.displayed) : draft}
            aria-invalid={!!error}
            onFocus={() => {
              live.finish();
              setEditing(true);
            }}
            onChange={(e) => {
              setDraft(e.target.value);
              setError('');
            }}
            onBlur={commit}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              }
              if (e.key === 'Escape') {
                setDraft(componentValueInput(component));
                setEditing(false);
                setError('');
              }
            }}
          />
          <span>{unit}</span>
        </div>
      </div>
      <input
        className="parameter-slider"
        type="range"
        min="0"
        max="1000"
        step="1"
        aria-label={`${component.label} ${label} 조절`}
        aria-valuetext={formatQuantity(live.displayed, unit)}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={live.displayed}
        value={((live.displayed - min) / (max - min)) * 1000}
        onChange={(e) => {
          const next = min + (max - min) * (Number(e.target.value) / 1000);
          live.change(Math.max(min, Math.min(max, Number(next.toPrecision(10)))));
          // Native range commit can arrive after pointerup (including a rounded duplicate).
          // It confirms the final value; it must not reopen the adjustment session.
          if (e.nativeEvent.type === 'change') live.finish();
        }}
        onPointerUp={live.finish}
        onPointerCancel={live.finish}
        onBlur={live.finish}
        onKeyUp={live.finish}
      />
      <div className="parameter-limits">
        <Notation text={formatQuantity(min, unit)} />
        <Notation text={formatQuantity(max, unit)} />
      </div>
      <div className="parameter-options">
        <PlaybackButton
          paused={!live.running}
          showLabel
          playLabel={`${unit === 'Ω' ? '저항' : label} 자동 조절`}
          pauseLabel={`${unit === 'Ω' ? '저항' : label} 자동 조절 일시 정지`}
          onToggle={live.running ? live.finish : live.start}
        />
      </div>
      {(error || live.failed) && (
        <p className="parameter-error" role="alert">
          {error || '값을 바꿀 수 없습니다.'}
        </p>
      )}
    </fieldset>
  );
}
