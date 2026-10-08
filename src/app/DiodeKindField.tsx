import { useId } from 'react';
import {
  isDiodeKind,
  type ComponentInstance,
  type DiodeKind,
} from '../domain';

/** Shared by the draft-based inline editor and the immediate inspector. */
export function DiodeKindField({
  component,
  value,
  disabled,
  onChange,
}: {
  component: ComponentInstance;
  value: DiodeKind;
  disabled?: boolean;
  onChange: (kind: DiodeKind) => void;
}) {
  const id = useId();
  return (
    <>
      <label className="field-label" htmlFor={id}>
        종류
      </label>
      <div>
        <select
          id={id}
          className="diode-kind-select"
          aria-label={`${component.label} 종류`}
          aria-describedby={`${id}-note`}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            if (isDiodeKind(event.target.value)) onChange(event.target.value);
          }}
        >
          <option value="signal">신호용</option>
          <option value="power">대전류용</option>
        </select>
      </div>
      <p id={`${id}-note`} className="tiny-note diode-kind-note">
        {value === 'signal'
          ? '작은 전류가 흐르는 회로에 사용해요.'
          : '큰 전류도 버틸 수 있어요.'}
      </p>
    </>
  );
}
