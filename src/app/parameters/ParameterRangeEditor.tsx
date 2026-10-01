import { useEffect, useState, type Ref } from 'react';
import type { ComponentInstance } from '../../domain';
import { adjustableParameter, type AdjustableParameter } from '../../component-library';
import { parseQuantity } from '../../quantity';
import './parameters.css';

export interface ParameterRange {
  min: number;
  max: number;
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
  return min !== undefined && max !== undefined && min > 0 && max > min ? { min, max } : null;
}

export function parameterRangeProperties(parameter: AdjustableParameter, range: ParameterRange) {
  const properties: Record<string, number | string | boolean> = {
    [parameter.minimumProperty]: range.min,
    [parameter.maximumProperty]: range.max,
  };
  const value = Math.max(range.min, Math.min(range.max, parameter.value));
  if (value !== parameter.value) {
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
  onChange: (properties: Record<string, number | string | boolean>) => boolean;
}) {
  const parameter = adjustableParameter(component)!;
  const [draft, setDraft] = useState({ min: String(parameter.min), max: String(parameter.max) });
  const [error, setError] = useState('');
  useEffect(() => {
    setDraft({ min: String(parameter.min), max: String(parameter.max) });
    setError('');
  }, [parameter.min, parameter.max]);
  function commit() {
    const range = parseParameterRange(draft, parameter);
    if (!range) {
      setError('0 < 최솟값 < 최댓값으로 입력하세요.');
      return;
    }
    const properties = parameterRangeProperties(parameter, range);
    if (Object.entries(properties).every(([key, value]) => component.properties[key] === value))
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
          setDraft({ min: String(parameter.min), max: String(parameter.max) });
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
