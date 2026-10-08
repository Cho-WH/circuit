import { useEffect, useId, useRef, useState } from 'react';
import { Download, Plus, RotateCcw } from 'lucide-react';
import { emptyDocument, type CircuitDocument } from '../domain';
import { recoverDocument, recoveryReason, type RecoverySource } from '../persistence';
import { GuideDialog } from './GuideDialog';
import { useDialogFocus } from './useDialogFocus';
import { saveBlob } from './download';

export function RecoveryDialog({ source, onResolve }: {
  source: RecoverySource;
  onResolve: (document: CircuitDocument) => boolean;
}) {
  const dialog = useDialogFocus(true, () => {});
  const titleId = useId();
  const [failed, setFailed] = useState<'restore' | 'save' | null>(null);
  const reason = {
    'older-version': '이전 형식으로 저장된 회로라 변환이 필요해요.',
    'newer-version': '현재 앱보다 새로운 형식으로 저장된 회로예요.',
    'invalid-data': '파일 형식이나 회로 정보에 오류가 있어 열 수 없어요.',
  }[recoveryReason(source.raw)];
  const [notice, setNotice] = useState('');
  const newButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (failed) newButton.current?.focus(); }, [failed]);
  function accept(document: CircuitDocument) {
    if (!onResolve(document)) {
      setFailed('save');
      setNotice('');
    }
  }
  return <GuideDialog dialogRef={dialog} titleId={titleId} eyebrow="회로 불러오기"
    title={failed === 'save' ? '회로를 저장하지 못했어요' : failed ? '회로를 복원하지 못했어요' : '회로를 열 수 없어요'}
    size="compact" dismissible={false} onClose={() => {}}
    footer={<>
      <button ref={newButton} onClick={() => accept(emptyDocument(`circuit-${crypto.randomUUID()}`))}><Plus size={16} aria-hidden="true" />새 회로로 시작</button>
      {!failed && <button className="primary" onClick={() => {
        const result = recoverDocument(source);
        if (result.ok) accept(result.document);
        else { setFailed('restore'); setNotice(''); }
      }}><RotateCcw size={16} aria-hidden="true" />복원</button>}
      <button className={failed ? 'primary' : undefined} onClick={() => {
        try {
          saveBlob(new Blob([source.raw], { type: 'application/json;charset=utf-8' }), source.filename ?? '회로-원본-백업.json');
          setNotice('원본 파일 다운로드를 시작했어요.');
        } catch { setNotice('다운로드하지 못했어요. 백업을 다시 눌러 주세요.'); }
      }}><Download size={16} aria-hidden="true" />백업</button>
    </>}>
    <p>{failed === 'save' ? '브라우저에 저장하지 못해 회로를 바꾸지 않았어요.' : reason}<br />
      {failed ? '원본을 백업하거나 새 회로로 시작해 주세요.' : '복원을 시도하거나 새 회로를 시작할 수 있어요.'}
    </p>
    <small>백업을 누르면 원본 파일을 내려받아요.</small>
    {notice && <p className="guide-status" role="status">{notice}</p>}
  </GuideDialog>;
}
