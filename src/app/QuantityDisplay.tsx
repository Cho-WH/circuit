import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { QuantityMode } from '../quantity';
const choices: readonly { value: QuantityMode; label: string }[] = [
  { value: 'auto', label: '자동 단위' },
  { value: 'scientific', label: '유효 숫자' },
  { value: 'plain', label: '원래 숫자' },
];
export function QuantityDisplaySelect({
  value,
  onChange,
  onApplyAll,
}: {
  value: QuantityMode;
  onChange: (value: QuantityMode) => void;
  onApplyAll: () => void;
}) {
  const [open, setOpen] = useState(false),
    id = useId(),
    host = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const selected = choices.findIndex((c) => c.value === value);
  const [focused, setFocused] = useState(selected);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    host.current
      ?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]')
      ?.focus();
    const outside = (event: PointerEvent) => {
      if (!host.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', outside);
    return () => window.removeEventListener('pointerdown', outside);
  }, [open]);
  function keys(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? choices.length - 1
          : event.key === 'ArrowDown'
            ? (focused + 1) % choices.length
            : event.key === 'ArrowUp'
              ? (focused + choices.length - 1) % choices.length
              : null;
    if (next !== null) {
      event.preventDefault();
      setFocused(next);
      host.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')[next]?.focus();
    }
  }
  return (
    <div
      className="quantity-setting"
      ref={host}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <span id={id + '-label'} className="quantity-setting-label">
        표시:
      </span>
      <div className="quantity-picker">
        <button
          ref={trigger}
          type="button"
          className="quantity-picker-trigger"
          aria-label="숫자 표시 방식"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => {
            setFocused(selected);
            setOpen(!open);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              e.stopPropagation();
              setFocused(selected);
              setOpen(true);
            }
          }}
        >
          <span>{choices[selected].label}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        {open && (
          <div
            className="quantity-picker-menu"
            id={id}
            role="listbox"
            aria-labelledby={id + '-label'}
            onKeyDown={keys}
          >
            {choices.map((choice, index) => (
              <button
                key={choice.value}
                type="button"
                role="option"
                tabIndex={index === focused ? 0 : -1}
                aria-selected={value === choice.value}
                onFocus={() => setFocused(index)}
                onClick={() => {
                  onChange(choice.value);
                  close();
                }}
              >
                <span>{choice.label}</span>
                {value === choice.value && <Check size={14} aria-hidden="true" />}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className="quantity-apply-all"
        onClick={onApplyAll}
        title="현재 표시 방식을 모든 부품에 적용"
      >
        전체 적용
      </button>
    </div>
  );
}
