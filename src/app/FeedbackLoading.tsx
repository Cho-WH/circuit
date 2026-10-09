import { MessageCircle, X } from 'lucide-react';
import { useDialogFocus } from './useDialogFocus';
import { FeedbackErrorDetails } from './FeedbackErrorDetails';
import type { FeedbackFailure } from './feedback-failure';

export function FeedbackLoading({
  onClose,
  onRetry,
  failure,
}: {
  onClose: () => void;
  onRetry?: () => void;
  failure?: FeedbackFailure;
}) {
  const ref = useDialogFocus(true, onClose);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className={`feedback-loading-dialog${failure ? ' feedback-failure-dialog' : ''}`}
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="한마디"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="dialog-close" aria-label="한마디 닫기" onClick={onClose}>
          <X size={20} />
        </button>
        <MessageCircle size={24} strokeWidth={1.4} />
        <h2>한마디</h2>
        {failure ? (
          <>
            <p role="alert">
              한마디를 열지 못했어요. 다시 시도하거나 창을 닫고 회로 작업을 계속할 수 있어요.
            </p>
            <div className="feedback-failure-actions">
              <button type="button" onClick={onRetry}>
                다시 시도
              </button>
              <button type="button" onClick={onClose}>
                닫기
              </button>
            </div>
            <p>
              계속 열리지 않으면 창을 닫고 파일 → 회로 파일 저장 후 페이지를 새로고침해 주세요.
              새로고침하면 실행 취소 기록은 초기화됩니다.
            </p>
            <FeedbackErrorDetails failure={failure} />
          </>
        ) : (
          <div className="loading-lines" role="status" aria-label="이야기를 불러오는 중">
            <i />
            <i />
            <i />
          </div>
        )}
      </section>
    </div>
  );
}
