import * as q from '../../rational';
import { useEffect, useState } from 'react';
import { PlaybackButton } from '../PlaybackButton';
import type { ComponentInstance } from '../../domain';
import {
  componentValueInput,
  parameterValueAt,
  type AdjustableParameter,
} from '../../component-library';
import { quantityInput, formatQuantity } from '../../quantity';
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
  stopEpoch,
  inspectIntermediate,
}: {
  component: ComponentInstance;
  parameter: AdjustableParameter;
  disabled: boolean;
  onChange: (value: q.StoredScalar, group?: object, fraction?: string) => boolean | 'stop';
  onAdjustingChange?: (id: string, adjusting: boolean) => void;
  stopEpoch?: number;
  inspectIntermediate?: boolean;
}) {
  const { min, max, value, unit, label } = parameter;
  const position = q.toNumber(q.mul(q.div(q.sub(value, min), q.sub(max, min)), 1000));
  const live = useLiveValue(position, 0, 1000, (step, group) =>
    onChange(parameterValueAt(parameter, step), group), { stopEpoch, inspectIntermediate, disabled, orderKey: component.id },
  );
  const displayed = live.adjusting ? parameterValueAt(parameter, live.displayed) : value;
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
    if (disabled) return;
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
            value={editing ? draft : live.running ? quantityInput(displayed) : draft}
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
        aria-valuetext={formatQuantity(displayed, unit)}
        aria-valuemin={Number.isFinite(q.toNumber(min)) ? q.toNumber(min) : undefined}
        aria-valuemax={Number.isFinite(q.toNumber(max)) ? q.toNumber(max) : undefined}
        aria-valuenow={Number.isFinite(q.toNumber(displayed)) ? q.toNumber(displayed) : undefined}
        value={live.displayed}
        onChange={(e) => {
          live.change(Number(e.target.value));
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
