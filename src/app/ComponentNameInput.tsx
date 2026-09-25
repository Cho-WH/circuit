import { useEffect, useId, useRef, useState } from 'react';
import { normalizeComponentLabel } from '../domain';
export function ComponentNameInput({
  value,
  onCommit,
  id,
  label,
}: {
  value: string;
  onCommit: (value: string) => boolean;
  id?: string;
  label: string;
}) {
  const [draft, setDraft] = useState(value),
    [error, setError] = useState('');
  const committed = useRef(value),
    errorId = useId();
  useEffect(() => {
    setDraft(value);
    committed.current = value;
    setError('');
  }, [value]);
  function commit() {
    const name = normalizeComponentLabel(draft);
    if (name === null) {
      setError('이름을 1~160자로 입력하세요.');
      return;
    }
    if (name !== committed.current && !onCommit(name)) {
      setError('이름을 바꿀 수 없습니다.');
      return;
    }
    committed.current = name;
    setDraft(name);
    setError('');
  }
  return (
    <>
      <input
        id={id}
        aria-label={label}
        aria-invalid={!!error || undefined}
        aria-describedby={error ? errorId : undefined}
        value={draft}
        maxLength={160}
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
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(value);
            setError('');
          }
        }}
      />
      {error && (
        <small id={errorId} role="alert">
          {error}
        </small>
      )}
    </>
  );
}
