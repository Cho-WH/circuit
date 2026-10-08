import { quantityInput } from '../quantity';
import * as q from '../rational';
import { SwitchStateButton } from './SwitchStateButton';
import { normalizeComponentLabel, diodeKindFor, type DiodeKind } from '../domain';
import { DiodeKindField } from './DiodeKindField';
import { useEffect, useRef, useState } from 'react';
import type { ComponentInstance, Point } from '../domain';
import {
  componentDefinitions,
  componentValueInput,
  componentNotationLayout,
  componentValue,
  adjustableParameter,
  notationMetrics,
} from '../component-library';
import { parseComponentValue } from './component-value';
import { Notation } from './Notation';
import { ParameterRangeInputs, parseParameterRange, type ParameterRange } from './parameters';

export interface ComponentEdit {
  label: string;
  value?: q.StoredScalar;
  fraction?: string;
  diodeKind?: DiodeKind;
  range?: ParameterRange;
}
interface Props {
  component: ComponentInstance;
  point: Point;
  viewport: { width: number; height: number };
  drawingScale: number;
  labelScale: number;
  editParameterRange?: boolean;
  editDiodeKind?: boolean;
  onCommit?: (id: string, edit: ComponentEdit) => boolean;
  onClose: () => void;
  onToggleSwitch?: () => boolean;
}

export function InlineComponentEditor({
  component: editingComponent,
  point: editorPoint,
  viewport,
  drawingScale,
  labelScale,
  editParameterRange = false,
  editDiodeKind = false,
  onCommit,
  onToggleSwitch,
  onClose: closeEditor,
}: Props) {
  const editingDefinition = componentDefinitions[editingComponent.type];
  const parameter = adjustableParameter(editingComponent);
  const editingRange = editParameterRange && parameter;
  const [editing, setEditing] = useState(() => ({
    id: editingComponent.id,
    label: editingComponent.label,
    diodeKind: diodeKindFor(editingComponent),
    draft: componentValueInput(editingComponent),
    error: '',
    range: { min: parameter ? quantityInput(parameter.min) : '', max: parameter ? quantityInput(parameter.max) : '' },
  }));
  const inlineInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inlineInput.current?.focus({ preventScroll: true });
    inlineInput.current?.select();
  }, []);
  const editorHeight = (editingRange ? 292 : editing.diodeKind ? 244 : 186) + (editing.error ? 54 : 0);
  const editLayout = componentNotationLayout(
    editingComponent,
    editingComponent.label,
    componentValue(editingComponent),
    14 * labelScale,
  );
  const editorGap = Math.max(
    72,
    (editLayout.value.y -
      editingComponent.position.y +
      notationMetrics(componentValue(editingComponent), 14 * labelScale).descent +
      18) *
      drawingScale,
  );
  const editorTop =
    editorPoint.y + editorGap + editorHeight < viewport.height
      ? editorPoint.y + editorGap
      : Math.max(8, editorPoint.y - editorGap - editorHeight);
  return (
    <form
      className="inline-value-editor"
      aria-label={`${editingComponent.label} 회로 위 값 편집`}
      style={{
        left: Math.max(8, Math.min(viewport.width - 288, editorPoint.x - 140)),
        top: editorTop,
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          closeEditor();
        }
      }}
      onSubmit={(e) => {
        e.preventDefault();
        const label = normalizeComponentLabel(editing.label);
        if (!label) {
          setEditing({ ...editing, error: '이름을 1~160자로 입력하세요.' });
          return;
        }
        const editedRange = editingRange
          ? parseParameterRange(editing.range, editingRange)
          : undefined;
        if (editingRange && !editedRange) {
          setEditing({ ...editing, error: '0 < 최솟값 < 최댓값으로 입력하세요.' });
          return;
        }
        const parsed = editingDefinition.property
          ? parseComponentValue(editingComponent, editing.draft, editedRange ?? undefined)
          : undefined;
        if (parsed && !parsed.ok) {
          setEditing({ ...editing, error: parsed.error });
          return;
        }
        if (
          onCommit?.(editing.id, {
            label,
            ...(editDiodeKind && editing.diodeKind !== diodeKindFor(editingComponent) ? { diodeKind: editing.diodeKind } : {}),
            ...(editedRange ? { range: editedRange } : {}),
            ...(parsed
              ? { value: parsed.value, ...(parsed.fraction ? { fraction: parsed.fraction } : {}) }
              : {}),
          })
        )
          closeEditor();
        else setEditing({ ...editing, error: '이 회로에서는 이름·값을 바꿀 수 없습니다.' });
      }}
    >
      <label htmlFor="inline-component-name">이름</label>
      <div className="inline-name-row">
        <input
          ref={editingDefinition.property ? undefined : inlineInput}
          id="inline-component-name"
          aria-label={`${editingComponent.label} 회로 위 이름`}
          maxLength={160}
          value={editing.label}
          onChange={(e) => setEditing({ ...editing, label: e.target.value, error: '' })}
        />
        <span className="inline-name-preview" aria-label="이름 미리보기">
          <Notation symbol text={editing.label} />
        </span>
      </div>
      {editingRange && (
        <>
          <label>{editingRange.label} 범위</label>
          <ParameterRangeInputs
            parameter={editingRange}
            draft={editing.range}
            invalid={!!editing.error}
            onChange={(range) => setEditing({ ...editing, range, error: '' })}
          />
        </>
      )}
      {editingDefinition.property && (
        <>
          <label htmlFor="inline-component-value">
            {editingDefinition.unit === 'Ω' ? '저항값' : '전압'}
          </label>
          <div>
            <input
              ref={inlineInput}
              id="inline-component-value"
              aria-label={`${editingComponent.label} 회로 위 값`}
              value={editing.draft}
              aria-invalid={Boolean(editing.error)}
              aria-describedby={editing.error ? 'inline-value-error' : undefined}
              onChange={(e) => setEditing({ ...editing, draft: e.target.value, error: '' })}
            />
            <span>{editingDefinition.unit}</span>
          </div>
        </>
      )}
      {editing.diodeKind && (
        <DiodeKindField component={editingComponent} value={editing.diodeKind} disabled={!editDiodeKind}
          onChange={diodeKind => setEditing({ ...editing, diodeKind, error: '' })} />
      )}
      {editingComponent.type === 'switch' && (
        <>
          <label htmlFor="inline-switch-state">상태</label>
          <div>
            <SwitchStateButton
              id="inline-switch-state"
              component={editingComponent}
              onToggle={() => {
                const applied = onToggleSwitch?.();
                setEditing((current) => ({
                  ...current,
                  error: applied ? '' : '이 회로에서는 스위치 상태를 바꿀 수 없습니다.',
                }));
              }}
            />
          </div>
        </>
      )}
      <div className="inline-edit-actions">
        <button className="primary" type="submit">
          적용
        </button>
        <button type="button" onClick={closeEditor}>
          취소
        </button>
      </div>
      {editing.error && (
        <p id="inline-value-error" role="alert">
          {editing.error}
        </p>
      )}
    </form>
  );
}
