import { useEffect, useState } from 'react';
import type { ComponentInstance } from '../../domain';
import {
  componentValueInput,
  parameterValueAt,
  type AdjustableParameter,
} from '../../component-library';
import { quantityInput, formatQuantity } from '../../quantity';
import * as q from '../../rational';
import { parseComponentValue } from '../component-value';
import './parameters.css';

/** RC draft: pointerup/blur never commits an electrical operation. */
export function RcParameterControl({
  component,
  parameter,
  disabled,
  onApply,
}: {
  component: ComponentInstance;
  parameter: AdjustableParameter;
  disabled: boolean;
  onApply: (value: q.StoredScalar, fraction?: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(componentValueInput(component));
  const [error, setError] = useState('');
  const committed = componentValueInput(component);
  useEffect(() => {
    setDraft(committed);
    setError('');
  }, [committed]);
  const parsed = parseComponentValue(component, draft);
  const value = parsed.ok ? parsed.value : parameter.value;
  const position = Math.max(
    0,
    Math.min(
      1000,
      q.toNumber(
        q.mul(q.div(q.sub(value, parameter.min), q.sub(parameter.max, parameter.min)), 1000),
      ),
    ),
  );
  async function apply() {
    if (disabled) return;
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError('');
    if (!(await onApply(parsed.value, parsed.fraction)))
      setError('적용하지 못했습니다. 입력값을 확인해 주세요.');
  }
  return (
    <fieldset
      className="parameter-control"
      disabled={disabled}
      aria-label={`${component.label} 조절`}
    >
      <div className="parameter-value-row">
        <label htmlFor={`rc-parameter-${component.id}`}>{parameter.label}</label>
        <div className="unit-input">
          <input
            id={`rc-parameter-${component.id}`}
            aria-label={`${component.label} ${parameter.label}`}
            value={draft}
            aria-invalid={!!error}
            onChange={(event) => {
              setDraft(event.target.value);
              setError('');
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') {
                event.preventDefault();
                void apply();
              }
              if (event.key === 'Escape') {
                setDraft(committed);
                setError('');
              }
            }}
          />
          <span>{parameter.unit}</span>
        </div>
      </div>
      <input
        className="parameter-slider"
        type="range"
        min="0"
        max="1000"
        step="1"
        aria-label={`${component.label} ${parameter.label} 조절`}
        value={position}
        aria-valuetext={formatQuantity(value, parameter.unit)}
        onChange={(event) => {
          setDraft(quantityInput(parameterValueAt(parameter, Number(event.target.value))));
          setError('');
        }}
      />
      <div className="parameter-limits">
        <span>{formatQuantity(parameter.min, parameter.unit)}</span>
        <span>{formatQuantity(parameter.max, parameter.unit)}</span>
      </div>
      <button type="button" onClick={() => void apply()}>
        적용
      </button>
      <p>평형에서 한 번씩 적용합니다.</p>
      {error && (
        <p className="parameter-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
