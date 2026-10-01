import * as q from '../rational';
import type { ComponentInstance } from '../domain';
import {
  adjustableParameter,
  componentDefinitions,
  componentValueInput,
} from '../component-library';
import { formatQuantity, parseQuantity } from '../quantity';

/** All value editors share validation; their draft and commit gestures remain local. */
export function parseComponentValue(
  component: ComponentInstance,
  draft: string,
  editedRange?: { min: q.Scalar; max: q.Scalar },
): { ok: true; value: q.StoredScalar; fraction?: string } | { ok: false; error: string } {
  const definition = componentDefinitions[component.type];
  const parsed = parseQuantity(draft, definition.unit);
  if (!parsed || (definition.unit === 'Ω' && q.sign(parsed.value) < 0))
    return {
      ok: false,
      error: `유효한 ${definition.unit === 'Ω' ? '0 이상 저항' : '전압'}을 입력하세요.`,
    };
  const range = editedRange ?? adjustableParameter(component);
  if (range && (q.compare(parsed.value,range.min) < 0 || q.compare(parsed.value,range.max) > 0)) {
    // A range-only edit keeps the existing rule: bring the unchanged value into range.
    if (editedRange && draft === componentValueInput(component))
      return { ok: true, value: q.store(q.clamp(parsed.value,range.min,range.max)) };
    return {
      ok: false,
      error: `${formatQuantity(range.min, definition.unit)}~${formatQuantity(range.max, definition.unit)} 범위로 입력하세요.`,
    };
  }
  return { ok: true, ...parsed };
}
