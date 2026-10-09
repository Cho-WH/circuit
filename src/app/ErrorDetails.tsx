import { useState } from 'react';

export function ErrorDetails({ report, label }: { report: string; label: string }) {
  const [copyStatus, setCopyStatus] = useState('');
  const [open, setOpen] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(report);
      setCopyStatus('오류 정보를 복사했어요.');
    } catch {
      setCopyStatus('복사하지 못했어요. 아래 내용을 선택해 복사해 주세요.');
    }
  }
  return (
    <details className="error-details" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary tabIndex={0}>오류 정보</summary>
      <p>문의할 때 이 정보를 함께 보내 주세요. 회로와 작성한 글은 포함하지 않습니다.</p>
      <textarea
        aria-label={label}
        tabIndex={open ? 0 : -1}
        readOnly
        value={report}
        onFocus={(event) => event.currentTarget.select()}
      />
      <button type="button" disabled={!open} onClick={() => void copy()}>
        오류 정보 복사
      </button>
      <p role="status">{copyStatus}</p>
    </details>
  );
}
