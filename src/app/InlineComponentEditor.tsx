import { SwitchStateButton } from './SwitchStateButton';
import { normalizeComponentLabel } from '../domain';
import { useEffect, useRef, useState } from 'react';
import type { ComponentInstance, Point } from '../domain';
import {
  componentDefinitions,
  componentValueInput,
  componentNotationLayout,
  componentValue,
  notationMetrics,
} from '../component-library';
import { parseQuantity } from '../quantity';
import { Notation } from './Notation';

export interface ComponentEdit {
  label: string;
  value?: number;
  fraction?: string;
}
interface Props {
  component: ComponentInstance;
  point: Point;
  viewport: { width: number; height: number };
  drawingScale: number;
  labelScale: number;
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
  onCommit,
  onToggleSwitch,
  onClose: closeEditor,
}: Props) {
  const editingDefinition = componentDefinitions[editingComponent.type];
  const [editing, setEditing] = useState(() => ({
    id: editingComponent.id,
    label: editingComponent.label,
    draft: componentValueInput(editingComponent),
    error: '',
  }));
  const inlineInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inlineInput.current?.focus({ preventScroll: true });
    inlineInput.current?.select();
  }, []);
  const editorHeight = editing.error ? 240 : 186;
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
        const parsed = editingDefinition.property
          ? parseQuantity(editing.draft, editingDefinition.unit)
          : undefined;
        if (editingDefinition.property && !parsed) {
          setEditing({
            ...editing,
            error: `유효한 ${editingDefinition.unit === 'Ω' ? '0 이상 저항' : '전압'}을 입력하세요.`,
          });
          return;
        }
        if (
          onCommit?.(editing.id, {
            label,
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
      {editingComponent.type === 'switch' && <>
        <label htmlFor="inline-switch-state">상태</label>
        <div><SwitchStateButton id="inline-switch-state" closed={editingComponent.properties.state==='closed'} onToggle={()=>{const applied=onToggleSwitch?.();setEditing(current=>({...current,error:applied?'':'이 회로에서는 스위치 상태를 바꿀 수 없습니다.'}));}}/></div>
      </>}
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
