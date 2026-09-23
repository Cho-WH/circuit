import { useEffect, useId, useRef, useState } from 'react';
import { CircleHelp } from 'lucide-react';

/** Click/touch, hover and keyboard accessible; Escape dismisses without closing the board. */
export function FeedbackIdentityNotice() {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return <div ref={root} className="feedback-identity-note" onPointerLeave={() => setOpen(false)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); } }}>
    <span>수정·삭제는 작성한 브라우저에서만 가능해요.</span>
    <button type="button" aria-label="글 수정·삭제 안내" aria-expanded={open} aria-controls={id} aria-describedby={open ? id : undefined} onClick={() => setOpen(true)} onFocus={() => setOpen(true)} onPointerEnter={event => { if (event.pointerType === 'mouse') setOpen(true); }}><CircleHelp size={15}/></button>
    {open && <div id={id} role="tooltip" className="feedback-identity-tooltip">작성한 글을 수정하거나 삭제하려면 글을 작성한 기기의 같은 브라우저에서 같은 사이트 주소로 접속해 주세요. 사이트 데이터를 지우거나 시크릿 모드를 종료하면 작성자 확인 정보가 사라져 관리할 수 없을 수 있어요.<br/><br/>삭제를 원하지만 직접 삭제하기 어려운 경우, 게시판에 비공개 글을 남기는 등 별도로 관리자에게 다시 요청해 주세요. 삭제할 글의 닉네임·작성일·내용을 함께 알려주시면 확인에 도움이 됩니다.</div>}
  </div>;
}
