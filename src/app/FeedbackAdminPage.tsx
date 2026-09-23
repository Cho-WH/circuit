import { useEffect, useState } from 'react';
import { ArrowLeft, LockKeyhole, RefreshCw } from 'lucide-react';
import type { AdminFeedbackPost, FeedbackAdminGateway } from '../feedback';
import { createBrowserFeedbackPreview } from '../feedback-local';
import './styles.css';
import './feedback.css';
import './feedback-admin.css';

const kinds = { review: '사용 후기', idea: '개선 제안', issue: '오류 제보' };
const dateLabel = (value: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
type Filter = 'all' | 'private' | 'deleted';

export function FeedbackAdminPage({ gateway }: { gateway?: FeedbackAdminGateway }) {
  const [posts, setPosts] = useState<AdminFeedbackPost[]>([]);
  const [loading, setLoading] = useState(Boolean(gateway));
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  useEffect(() => {
    let current = true;
    setPosts([]); setError('');
    if (!gateway) { setLoading(false); return; }
    setLoading(true);
    void gateway.list().then(result => {
      if (!current) return;
      if (result.ok) setPosts(result.value);
      else setError(result.code === 'FORBIDDEN' ? '관리자 권한을 확인할 수 없습니다.' : '보관함을 불러오지 못했습니다. 다시 시도해 주세요.');
    }).catch(() => { if (current) setError('보관함을 불러오지 못했습니다. 다시 시도해 주세요.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [gateway, revision]);
  const shown = posts.filter(post => filter === 'all' || (filter === 'private' ? post.visibility === 'private' : post.deletedAt !== null));
  return <main className="feedback-admin feedback-board">
    <header className="feedback-admin-header"><a href={import.meta.env.BASE_URL}><ArrowLeft size={16}/> 회로 실험실</a><span><LockKeyhole size={14}/> 관리자</span></header>
    <section className="feedback-admin-intro"><p className="feedback-kicker">선생님들의 한마디</p><h1>후기 보관함</h1><p>공개·비공개 이야기와 삭제된 기록을 한곳에서 확인합니다.</p></section>
    {!gateway ? <section className="feedback-admin-unavailable"><LockKeyhole size={24}/><h2>관리자 인증 연결이 필요합니다</h2><p>서버의 관리자 권한 확인을 연결한 뒤 보관함을 이용할 수 있습니다.</p></section> : <>
      <nav className="feedback-tabs" aria-label="보관함 필터">{(['all', 'private', 'deleted'] as Filter[]).map(value => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? '전체' : value === 'private' ? '비공개' : '삭제된 글'}</button>)}<button className="feedback-refresh" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={13}/> 새로고침</button></nav>
      <p className="feedback-view-note">현재 이 브라우저에 저장된 글입니다. 서버 연결 전에는 다른 기기의 글이 표시되지 않습니다.</p>
      {error && <div className="feedback-load-error" role="alert"><p>{error}</p><button onClick={() => setRevision(value => value + 1)}>다시 시도</button></div>}
      {loading && <p className="feedback-loading" role="status">보관함을 불러오는 중…</p>}
      {!loading && !error && <><p className="feedback-admin-count">{shown.length}개의 기록</p><div className="feedback-posts">{shown.map(post => <article key={post.id} className={`feedback-post${post.deletedAt ? ' feedback-post-deleted' : ''}`}>
        <div className={`feedback-avatar feedback-avatar-${post.kind}`} aria-hidden="true">{Array.from(post.nickname)[0]}</div><div className="feedback-post-main"><div className="feedback-post-heading"><strong>{post.nickname}</strong><span className={`feedback-kind feedback-kind-${post.kind}`}>{kinds[post.kind]}</span><span className="feedback-private">{post.visibility === 'private' && <LockKeyhole size={12}/>} {post.visibility === 'private' ? '비공개' : '공개'}</span>{post.deletedAt && <span className="feedback-deleted-label">삭제된 글</span>}</div><p className="feedback-post-content expanded">{post.content}</p><div className="feedback-post-footer"><time dateTime={post.createdAt}>작성 {dateLabel(post.createdAt)}</time>{post.deletedAt && <time dateTime={post.deletedAt}>삭제 {dateLabel(post.deletedAt)}</time>}</div></div>
      </article>)}</div>{shown.length === 0 && <div className="feedback-empty"><h2>표시할 기록이 없습니다</h2></div>}</>}
    </>}
  </main>;
}

export function FeedbackAdminApp() {
  // Production stays closed until a server-authorized administrator gateway is supplied.
  const [gateway] = useState(() => import.meta.env.DEV ? createBrowserFeedbackPreview().admin : undefined);
  return <FeedbackAdminPage gateway={gateway}/>;
}
