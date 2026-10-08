import type { ComponentProperties } from '../../domain';
import * as q from '../../rational';
import { useEffect, useState, type Ref } from 'react';
import { isStoredScalar, type ComponentInstance } from '../../domain';
import { adjustableParameter, type AdjustableParameter } from '../../component-library';
import { quantityInput, parseQuantity } from '../../quantity';
import './parameters.css';

export interface ParameterRange {
  min: q.StoredScalar;
  max: q.StoredScalar;
}
export interface ParameterRangeDraft {
  min: string;
  max: string;
}

export function parseParameterRange(
  draft: ParameterRangeDraft,
  parameter: AdjustableParameter,
): ParameterRange | null {
  const min = parseQuantity(draft.min, parameter.unit)?.value;
  const max = parseQuantity(draft.max, parameter.unit)?.value;
  return min !== undefined &&
    max !== undefined &&
    (parameter.allowZero ? q.sign(min) >= 0 : q.sign(min) > 0) &&
    q.compare(max, min) > 0
    ? { min, max }
    : null;
}

export function parameterRangeError(parameter: AdjustableParameter) {
  return `0 ${parameter.allowZero ? '≤' : '<'} 최솟값 < 최댓값으로 입력하세요.`;
}

export function parameterRangeProperties(parameter: AdjustableParameter, range: ParameterRange) {
  const properties: ComponentProperties = {
    [parameter.minimumProperty]: range.min,
    [parameter.maximumProperty]: range.max,
  };
  const value = q.store(q.clamp(parameter.value, range.min, range.max));
  if (!q.equal(value, parameter.value)) {
    properties[parameter.property] = value;
    properties[parameter.property + 'Fraction'] = '';
  }
  return properties;
}

export function ParameterRangeInputs({
  parameter,
  draft,
  onChange,
  invalid,
  inputRef,
}: {
  parameter: AdjustableParameter;
  draft: ParameterRangeDraft;
  onChange: (draft: ParameterRangeDraft) => void;
  invalid?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <div className="parameter-range-fields">
      {(['min', 'max'] as const).map((key) => (
        <label key={key}>
          {key === 'min' ? '최솟값' : '최댓값'}
          <div className="unit-input">
            <input
              ref={key === 'min' ? inputRef : undefined}
              aria-label={`${parameter.label} ${key === 'min' ? '최솟값' : '최댓값'}`}
              value={draft[key]}
              aria-invalid={!!invalid}
              onChange={(e) => onChange({ ...draft, [key]: e.target.value })}
            />
            <span>{parameter.unit}</span>
          </div>
        </label>
      ))}
    </div>
  );
}

export function ParameterRangeFields({
  component,
  onChange,
}: {
  component: ComponentInstance;
  onChange: (properties: ComponentProperties) => boolean;
}) {
  const parameter = adjustableParameter(component)!;
  const [draft, setDraft] = useState({
    min: quantityInput(parameter.min),
    max: quantityInput(parameter.max),
  });
  const [error, setError] = useState('');
  useEffect(() => {
    setDraft({ min: quantityInput(parameter.min), max: quantityInput(parameter.max) });
    setError('');
  }, [
    parameter.min.numerator,
    parameter.min.denominator,
    parameter.max.numerator,
    parameter.max.denominator,
  ]);
  function commit() {
    const range = parseParameterRange(draft, parameter);
    if (!range) {
      setError(parameterRangeError(parameter));
      return;
    }
    const properties = parameterRangeProperties(parameter, range);
    if (
      Object.entries(properties).every(([key, value]) =>
        isStoredScalar(value)
          ? isStoredScalar(component.properties[key]) && q.equal(component.properties[key], value)
          : component.properties[key] === value,
      )
    )
      return;
    setError(onChange(properties) ? '' : '범위를 바꿀 수 없습니다.');
  }
  return (
    <div
      className="parameter-range"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) commit();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
        if (e.key === 'Escape') {
          setDraft({ min: quantityInput(parameter.min), max: quantityInput(parameter.max) });
          setError('');
        }
      }}
    >
      <span className="field-label">{parameter.label} 범위</span>
      <ParameterRangeInputs
        parameter={parameter}
        draft={draft}
        invalid={!!error}
        onChange={(next) => {
          setDraft(next);
          setError('');
        }}
      />
      {error && (
        <p className="parameter-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
