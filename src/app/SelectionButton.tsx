import type { ComponentPropsWithRef } from 'react';
import './selection-button.css';

type SelectionButtonProps = Omit<ComponentPropsWithRef<'button'>, 'aria-pressed'> & {
  selected: boolean;
};

/** 공통 선택 상태 표시 효과. 아이콘과 배치는 사용하는 화면에서 정한다. */
export function SelectionButton({ selected, className = '', type = 'button', ...props }: SelectionButtonProps) {
  return <button {...props} type={type} className={`selection-button ${className}`} aria-pressed={selected} />;
}
