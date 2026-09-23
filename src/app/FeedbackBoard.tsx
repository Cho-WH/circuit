import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, Check, ChevronDown, Globe2, LockKeyhole, MessageCircle, PencilLine, Trash2, X } from 'lucide-react';
import { feedbackLimits, type FeedbackDraft, type FeedbackError, type FeedbackGateway, type FeedbackKind, type FeedbackPost } from '../feedback';
import { createBrowserFeedbackPreview } from '../feedback-local';
import './feedback.css';
import { FeedbackIdentityNotice } from './FeedbackIdentityNotice';

const labels: Record<FeedbackKind, string> = { review: '사용 후기', idea: '개선 제안', issue: '오류 제보' };
const errors: Record<FeedbackError, string> = {
  INVALID_INPUT: '닉네임과 내용을 확인해 주세요.',
  DAILY_LIMIT: '오늘은 더 이상 글을 남길 수 없어요. 내일 다시 들러 주세요.',
  NOT_FOUND: '이미 삭제되었거나 찾을 수 없는 글이에요.',
  UNAVAILABLE: '게시판을 불러오거나 저장하지 못했어요. 잠시 후 다시 시도해 주세요.',
  FORBIDDEN: '글을 작성한 브라우저에서만 관리할 수 있어요. 삭제가 어려우면 관리자에게 다시 요청해 주세요.',
};
const emptyDraft = (): FeedbackDraft => ({ nickname: '', content: '', kind: 'review', visibility: 'public' });
const dateLabel = (iso: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
type View = 'public' | 'mine';

function NoteDrawing() {
  return <svg className="feedback-drawing" width="104" height="90" viewBox="0 0 104 90" fill="none" aria-hidden="true">
    <path d="M24 18L77 13Q84 13 85 21L90 62Q91 69 83 70L47 74L31 83L31 74Q24 75 23 66L18 28Q17 20 24 18Z" fill="#f5cf82" stroke="#7d6140" strokeWidth="1.6"/>
    <path d="M33 33L70 29M35 42L60 39" stroke="#9a7446" strokeWidth="2" strokeLinecap="round"/>
    <circle cx="44" cy="55" r="2" fill="#664d34"/><circle cx="64" cy="53" r="2" fill="#664d34"/>
    <path d="M49 61Q55 66 60 59" stroke="#664d34" strokeWidth="1.6" strokeLinecap="round"/>
    <path d="M10 12L14 17M33 3L34 10M92 8L87 14" stroke="#a99170" strokeWidth="1.8" strokeLinecap="round"/>
  </svg>;
}

export function FeedbackBoard({ gateway, onClose }: { gateway: FeedbackGateway; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<View>('public');
  const [posts, setPosts] = useState<FeedbackPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const request = useRef(0);
  const mutation = useRef(false);
  const restoreComposeFocus = useRef(false);
  const composeButton = useRef<HTMLButtonElement>(null);
  const nicknameInput = useRef<HTMLInputElement>(null);
  const formErrorElement = useRef<HTMLParagraphElement>(null);
  const deleteErrorElement = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { request.current++; element.close(); document.body.style.overflow = oldOverflow; previous?.focus(); };
  }, []);
  useEffect(() => { if (writing) nicknameInput.current?.focus(); }, [writing, editId]);
  useEffect(() => {
    if (!busy && restoreComposeFocus.current) {
      restoreComposeFocus.current = false;
      composeButton.current?.focus({ preventScroll: false });
    }
  }, [busy]);
  useEffect(() => {
    if (!busy) {
      if (deleteError) deleteErrorElement.current?.focus();
      else if (formError) formErrorElement.current?.focus();
    }
  }, [busy, formError, deleteError]);

  const load = useCallback(async (target: View, next?: string) => {
    const id = ++request.current;
    setLoading(true); setLoadError('');
    try {
      const result = await gateway.list({ scope: target, cursor: next });
      if (id !== request.current) return;
      if (!result.ok) { setLoadError(errors[result.code]); return; }
      const data = result.value;
      setPosts(previous => next ? [...previous, ...data.posts.filter(post => !previous.some(item => item.id === post.id))] : data.posts);
      setCursor(data.nextCursor);
    } catch { if (id === request.current) setLoadError(errors.UNAVAILABLE); }
    finally { if (id === request.current) setLoading(false); }
  }, [gateway]);
  useEffect(() => { setPosts([]); setCursor(null); setDeleteId(null); void load(view); }, [view, load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mutation.current) return;
    mutation.current = true; setBusy(true); setFormError(''); setNotice('');
    try {
      const result = editId ? await gateway.update({ id: editId, draft }) : await gateway.create(draft);
      if (!result.ok) { setFormError(errors[result.code]); return; }
      setDraft(emptyDraft()); setWriting(false); setEditId(null);
      setNotice(editId ? '글을 수정했어요.' : draft.visibility === 'private' ? '비공개로 남겼어요. 내가 쓴 글에서 확인할 수 있어요.' : '한마디를 남겼어요. 고맙습니다!');
      const target = draft.visibility === 'private' ? 'mine' : editId ? view : 'public';
      if (view !== target) setView(target); else await load(target);
      restoreComposeFocus.current = true;
    } catch { setFormError(errors.UNAVAILABLE); }
    finally { mutation.current = false; setBusy(false); }
  }
  async function remove(event: FormEvent) {
    event.preventDefault();
    if (!deleteId || mutation.current) return;
    mutation.current = true; setBusy(true); setDeleteError(''); setNotice('');
    try {
      const result = await gateway.remove({ id: deleteId });
      if (!result.ok) { setDeleteError(errors[result.code]); return; }
      setDeleteId(null); if (editId === deleteId) { setEditId(null); setWriting(false); setDraft(emptyDraft()); } setNotice('글을 삭제했어요. 관리자 보관함에는 기록이 남습니다.');
      await load(view);
      restoreComposeFocus.current = true;
    } catch { setDeleteError(errors.UNAVAILABLE); }
    finally { mutation.current = false; setBusy(false); }
  }
  function changeView(next: View) { setView(next); cancelWriting(); setNotice(''); }
  function cancelWriting() { setWriting(false); setFormError(''); if (editId) setDraft(emptyDraft()); setEditId(null); composeButton.current?.focus(); }
  function edit(post: FeedbackPost) { setEditId(post.id); setDraft({ nickname: post.nickname, content: post.content, kind: post.kind, visibility: post.visibility }); setWriting(true); setDeleteId(null); setFormError(''); setNotice(''); }

  return <dialog ref={dialog} className="feedback-dialog" aria-labelledby="feedback-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="feedback-board">
      <header className="feedback-header"><span><MessageCircle size={15}/> 회로 실험실 · 이야기 노트</span><button type="button" className="feedback-icon-button" onClick={onClose} disabled={busy} aria-label="게시판 닫기"><X size={20}/></button></header>
      <div className="feedback-scroll">
        <section className="feedback-intro"><div><p className="feedback-kicker">수업에서 써보니, 어땠나요?</p><h1 id="feedback-title">선생님들의 한마디<span className="feedback-title-dot">.</span></h1><p>좋았던 순간도, 조금 아쉬웠던 점도.<br/>다음 수업을 위한 작은 힌트를 남겨 주세요.</p></div><NoteDrawing/></section>
        <div className="feedback-compose-invite"><span>짧은 한 줄도 좋아요.</span><button type="button" ref={composeButton} className="feedback-primary" aria-expanded={writing} aria-controls="feedback-compose" onClick={() => { if (writing) cancelWriting(); else { setWriting(true); setEditId(null); setFormError(''); setNotice(''); } }} disabled={busy}><PencilLine size={15}/> 한마디 남기기</button></div>
        <FeedbackIdentityNotice/>
        {writing && <form id="feedback-compose" className="feedback-compose" onSubmit={event => void submit(event)}>
          <div className="feedback-form-heading"><h2>{editId ? '이야기 수정하기' : '어떤 이야기를 남길까요?'}</h2><button type="button" className="feedback-icon-button" aria-label="글 작성 접기" onClick={cancelWriting} disabled={busy}><X size={17}/></button></div>
          <fieldset className="feedback-kind-options" disabled={busy}><legend className="feedback-sr-only">글 종류</legend>{(Object.keys(labels) as FeedbackKind[]).map(kind => <label key={kind}><input type="radio" name="feedback-kind" checked={draft.kind === kind} onChange={() => setDraft({ ...draft, kind })}/><span>{labels[kind]}</span></label>)}</fieldset>
          <label className="feedback-sr-only" htmlFor="feedback-content">후기 및 피드백 내용</label>
          <textarea id="feedback-content" required maxLength={feedbackLimits.content} rows={4} value={draft.content} disabled={busy} placeholder="어떤 수업에서 써보셨나요? 사용하며 느낀 점을 편하게 적어 주세요." onChange={event => setDraft({ ...draft, content: event.target.value })}/>
          <span className="feedback-character-count">{draft.content.length.toLocaleString()} / 2,000</span>
          <div className="feedback-fields feedback-fields-single"><label>닉네임<input ref={nicknameInput} required maxLength={feedbackLimits.nickname} value={draft.nickname} disabled={busy} placeholder="자유롭게 지어 주세요" autoComplete="off" onChange={event => setDraft({ ...draft, nickname: event.target.value })}/></label></div>
          <fieldset className="feedback-visibility" disabled={busy}><legend>공개 범위</legend><label><input type="radio" name="feedback-visibility" checked={draft.visibility === 'public'} onChange={() => setDraft({ ...draft, visibility: 'public' })}/><span><Globe2 size={15}/> 공개<small>다른 선생님과 함께 읽어요</small></span></label><label><input type="radio" name="feedback-visibility" checked={draft.visibility === 'private'} onChange={() => setDraft({ ...draft, visibility: 'private' })}/><span><LockKeyhole size={15}/> 비공개<small>작성자와 관리자만 읽어요</small></span></label></fieldset>
          {formError && <p ref={formErrorElement} tabIndex={-1} className="feedback-error" role="alert">{formError}</p>}
          <div className="feedback-submit-row"><span>삭제 후에도 관리자에게는 기록이 남아요.</span><button type="submit" className="feedback-primary" disabled={busy}>{busy ? '저장 중…' : editId ? '수정 저장' : '글 남기기'}<ArrowUpRight size={16}/></button></div>
        </form>}
        <p className="feedback-notice" role="status">{notice && <><Check size={15}/>{notice}</>}</p>
        <nav className="feedback-tabs" aria-label="게시글 보기"><button type="button" aria-pressed={view === 'public'} onClick={() => changeView('public')} disabled={busy}>모든 이야기</button><button type="button" aria-pressed={view === 'mine'} onClick={() => changeView('mine')} disabled={busy}>내가 쓴 글</button><button type="button" className="feedback-refresh" onClick={() => void load(view)} disabled={busy || loading}>새로고침</button></nav>
        {view === 'mine' && <p className="feedback-view-note">이 브라우저에서 남긴 공개·비공개 글이에요.</p>}
        {loadError && <div className="feedback-load-error" role="alert"><p>{loadError}</p><button type="button" onClick={() => void load(view, cursor ?? undefined)}>다시 시도</button></div>}
        {!loading && !loadError && posts.length === 0 && <div className="feedback-empty"><MessageCircle size={27} strokeWidth={1.3}/><h2>{view === 'mine' ? '아직 남긴 이야기가 없어요' : '첫 이야기를 기다리고 있어요'}</h2><p>수업에 도움이 된 점, 있으면 좋을 기능.<br/>편하게 한마디 남겨 주세요.</p></div>}
        <div className="feedback-posts" aria-busy={loading}>{posts.map(post => <article key={post.id} className="feedback-post">
          <div className={`feedback-avatar feedback-avatar-${post.kind}`} aria-hidden="true">{Array.from(post.nickname)[0]}</div><div className="feedback-post-main"><div className="feedback-post-heading"><strong>{post.nickname}</strong><span className={`feedback-kind feedback-kind-${post.kind}`}>{labels[post.kind]}</span>{post.visibility === 'private' && <span className="feedback-private"><LockKeyhole size={12}/> 비공개</span>}</div>
          <PostBody content={post.content}/><div className="feedback-post-footer"><span><time dateTime={post.createdAt}>{dateLabel(post.createdAt)}</time>{post.updatedAt && <span className="feedback-edited" title={dateLabel(post.updatedAt)}> · 수정됨</span>}</span>{post.canManage && <span className="feedback-post-actions"><button type="button" disabled={busy} aria-label={`${post.nickname}의 글 수정`} onClick={() => edit(post)}>수정</button><button type="button" disabled={busy} aria-label={`${post.nickname}의 글 삭제`} onClick={() => { setDeleteId(deleteId === post.id ? null : post.id); setDeleteError(''); }}>삭제</button></span>}</div>
          {deleteId === post.id && <form className="feedback-delete-form" onSubmit={event => void remove(event)}><strong>이 글을 삭제할까요?</strong><p>게시판에서 삭제되며, 관리자에게는 원문이 남아요.</p>{deleteError && <p ref={deleteErrorElement} tabIndex={-1} className="feedback-error" role="alert">{deleteError}</p>}<div><button type="button" disabled={busy} onClick={() => { setDeleteId(null); }}>취소</button><button type="submit" className="feedback-delete-button" disabled={busy}><Trash2 size={14}/>{busy ? '삭제 중…' : '삭제하기'}</button></div></form>}
          </div>
        </article>)}</div>
        {loading && <p className="feedback-loading" role="status">이야기를 불러오는 중…</p>}
        {cursor && !loadError && <button type="button" className="feedback-more" disabled={loading || busy} onClick={() => void load(view, cursor)}>이야기 더 보기<ChevronDown size={16}/></button>}
        <footer className="feedback-bottom"><span>이 브라우저에만 저장되는 미리보기입니다.</span></footer>
      </div>
    </div>
  </dialog>;
}

function PostBody({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const body = useRef<HTMLParagraphElement>(null);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const element = body.current!;
    const measure = () => { if (!expanded) setOverflows(element.scrollHeight > element.clientHeight + 1); };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, [content, expanded]);
  return <><p ref={body} className={`feedback-post-content${expanded ? ' expanded' : ''}`}>{content}</p>{(overflows || expanded) && <button type="button" className="feedback-expand" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '접기' : '더 읽기'}<ChevronDown size={13}/></button>}</>;
}

export default function FeedbackFeature({ onClose }: { onClose: () => void }) {
  const [ports] = useState(createBrowserFeedbackPreview);
  return <FeedbackBoard gateway={ports.gateway} onClose={onClose}/>;
}
