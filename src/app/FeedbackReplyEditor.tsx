import { useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { validFeedbackReply, type AdminFeedbackPost, type FeedbackAdminGateway, type FeedbackReply as Reply } from '../feedback';
import { FeedbackReply } from './FeedbackReply';

export function FeedbackReplyEditor({ post, gateway, onSaved }: { post: AdminFeedbackPost; gateway: FeedbackAdminGateway; onSaved: (reply: Reply) => void }) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(post.reply?.content ?? '');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function save() {
    if (pending.current || !validFeedbackReply(content) || post.deletedAt) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = await gateway.saveReply({ id: post.id, content: content.trim() });
      if (!result.ok) {
        setError(result.code === 'FORBIDDEN' ? '답변 권한을 확인할 수 없습니다. 관리자 로그인을 확인해 주세요.' : result.code === 'NOT_FOUND' ? '삭제되었거나 찾을 수 없는 글입니다. 보관함을 새로고침해 주세요.' : '답변을 저장하지 못했습니다. 입력한 내용은 유지됩니다. 다시 시도해 주세요.');
        return;
      }
      onSaved(result.value); setContent(result.value.content); setEditing(false); setNotice('답변을 저장했습니다.');
    } catch { setError('답변을 저장하지 못했습니다. 입력한 내용은 유지됩니다. 다시 시도해 주세요.'); }
    finally { pending.current = false; setBusy(false); }
  }
  return <>
    <FeedbackReply reply={post.reply}/>
    {!post.deletedAt && (editing ? <form className="feedback-compose feedback-reply-editor" onSubmit={event => { event.preventDefault(); void save(); }}>
      <label>개발자 답변<textarea autoFocus value={content} maxLength={2000} disabled={busy} onChange={event => setContent(event.target.value)} /></label>
      <span className="feedback-character-count">{content.length} / 2000</span>
      <p className="feedback-field-help">{post.visibility === 'public' ? '공개 글의 답변은 한마디 게시판에 함께 표시됩니다.' : '비공개 글의 답변은 작성자와 관리자만 볼 수 있습니다.'}</p>
      {error && <p className="feedback-error" role="alert">{error}</p>}
      <div className="feedback-reply-actions"><button type="button" className="feedback-secondary" disabled={busy} onClick={() => { setEditing(false); setContent(post.reply?.content ?? ''); setError(''); }}>취소</button><button className="feedback-primary" type="submit" disabled={busy || !validFeedbackReply(content)}>{busy ? '저장 중…' : post.reply ? '답변 수정 저장' : '답변 등록'}</button></div>
    </form> : <button className="feedback-reply-trigger" type="button" onClick={() => { setContent(post.reply?.content ?? ''); setNotice(''); setEditing(true); }}><MessageSquare size={14}/>{post.reply ? '답변 수정' : '답변 작성'}</button>)}
    <p className="feedback-notice" role="status">{notice}</p>
  </>;
}
