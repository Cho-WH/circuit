import { MessageCircle, X } from 'lucide-react';
import { useDialogFocus } from './useDialogFocus';

export function FeedbackLoading({ onClose }: { onClose: () => void }) {
  const ref = useDialogFocus(true, onClose);
  return <div className="modal-backdrop" onClick={onClose}>
    <section className="feedback-loading-dialog" ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label="한마디" onClick={e => e.stopPropagation()}>
      <button className="dialog-close" aria-label="한마디 닫기" onClick={onClose}><X size={20}/></button>
      <MessageCircle size={24} strokeWidth={1.4}/><h2>한마디</h2>
      <div className="loading-lines" role="status" aria-label="이야기를 불러오는 중"><i/><i/><i/></div>
    </section>
  </div>;
}
