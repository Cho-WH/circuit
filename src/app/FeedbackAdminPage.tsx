import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, LockKeyhole, RefreshCw } from 'lucide-react';
import type { AdminFeedbackPost, FeedbackAdminGateway } from '../feedback';
import { createFirebaseAdminAccess, type AdminSession } from '../feedback-firebase';
import './styles.css';
import './feedback.css';
import './feedback-admin.css';

const kinds = { review: '사용 후기', idea: '개선 제안', issue: '오류 제보' };
const dateLabel = (value: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
type Filter = 'all' | 'private' | 'deleted';

export function FeedbackAdminPage({ gateway, authentication }: { gateway?: FeedbackAdminGateway; authentication?: ReactNode }) {
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
    {authentication}
    {!gateway ? authentication ? null : <section className="feedback-admin-unavailable"><LockKeyhole size={24}/><h2>관리자 인증 연결이 필요합니다</h2><p>서버의 관리자 권한 확인을 연결한 뒤 보관함을 이용할 수 있습니다.</p></section> : <>
      <nav className="feedback-tabs" aria-label="보관함 필터">{(['all', 'private', 'deleted'] as Filter[]).map(value => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? '전체' : value === 'private' ? '비공개' : '삭제된 글'}</button>)}<button className="feedback-refresh" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={13}/> 새로고침</button></nav>
      <p className="feedback-view-note">작성자가 삭제한 글도 마지막 내용과 삭제 기록을 보관합니다.</p>
      {error && <div className="feedback-load-error" role="alert"><p>{error}</p><button onClick={() => setRevision(value => value + 1)}>다시 시도</button></div>}
      {loading && <p className="feedback-loading" role="status">보관함을 불러오는 중…</p>}
      {!loading && !error && <><p className="feedback-admin-count">{shown.length}개의 기록</p><div className="feedback-posts">{shown.map(post => <article key={post.id} className={`feedback-post${post.deletedAt ? ' feedback-post-deleted' : ''}`}>
        <div className={`feedback-avatar feedback-avatar-${post.kind}`} aria-hidden="true">{Array.from(post.nickname)[0]}</div><div className="feedback-post-main"><div className="feedback-post-heading"><strong>{post.nickname}</strong><span className={`feedback-kind feedback-kind-${post.kind}`}>{kinds[post.kind]}</span><span className="feedback-private">{post.visibility === 'private' && <LockKeyhole size={12}/>} {post.visibility === 'private' ? '비공개' : '공개'}</span>{post.deletedAt && <span className="feedback-deleted-label">삭제된 글</span>}</div><p className="feedback-post-content expanded">{post.content}</p><div className="feedback-post-footer"><time dateTime={post.createdAt}>작성 {dateLabel(post.createdAt)}</time>{post.deletedAt && <time dateTime={post.deletedAt}>삭제 {dateLabel(post.deletedAt)}</time>}</div></div>
      </article>)}</div>{shown.length === 0 && <div className="feedback-empty"><h2>표시할 기록이 없습니다</h2></div>}</>}
    </>}
  </main>;
}

export function FeedbackAdminApp() {
  const [access] = useState(createFirebaseAdminAccess);
  const [session, setSession] = useState<AdminSession>({ state: 'checking' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sessionRef = useRef(session);
  useEffect(() => access.subscribe(next => {
    sessionRef.current = next;
    setSession(next);
    setError('');
  }), [access]);
  const authorized = session.state === 'authorized';
  async function login() {
    setBusy(true); setError('');
    try { await access.signIn(); }
    catch (failure) {
      // Another tab or the popup may finish authentication before its close event.
      if (sessionRef.current.state === 'authorized' || sessionRef.current.state === 'forbidden') return;
      const code = failure && typeof failure === 'object' && 'code' in failure ? failure.code : '';
      const messages: Record<string, string> = {
        'auth/popup-blocked': '로그인 팝업이 차단되었습니다. 이 사이트의 팝업을 허용하고 다시 시도해 주세요.',
        'auth/popup-closed-by-user': '로그인 창이 닫혔습니다. 다시 로그인해 주세요.',
        'auth/unauthorized-domain': '이 사이트 주소의 Google 로그인이 아직 허용되지 않았습니다. Firebase 인증 설정을 확인해 주세요.',
        'auth/operation-not-allowed': 'Google 로그인 설정을 확인해 주세요.',
        'auth/network-request-failed': '네트워크에 연결하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.',
      };
      setError(typeof code === 'string' && messages[code] ? messages[code] : '로그인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError(''); setSession({ state: 'checking' });
    try { await access.signOut(); }
    catch { setSession({ state: 'error' }); setError('로그아웃하지 못했습니다. 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  }
  return <FeedbackAdminPage key={session.state === 'authorized' ? session.uid : session.state}
    gateway={authorized ? access.gateway : undefined}
    authentication={<section className="feedback-admin-auth">
      {session.state === 'checking' && <p role="status">관리자 권한을 확인하는 중…</p>}
      {session.state === 'signed-out' && <p>등록된 관리자 Google 계정으로 로그인해 주세요.</p>}
      {session.state === 'forbidden' && <><p>이 계정에는 관리자 권한이 없습니다.</p><details><summary>최초 관리자 등록 정보</summary><p>Firebase 콘솔에서 아래 UID를 관리자 허용 목록에 등록해야 합니다.</p><code>{session.uid}</code></details></>}
      {session.state === 'error' && <p role="alert">관리자 권한을 확인하지 못했습니다. 연결 상태를 확인하고 다시 로그인해 주세요.</p>}
      {authorized && <p>관리자 계정으로 연결되었습니다.</p>}
      {session.state !== 'checking' && !authorized && <button className="feedback-primary" disabled={busy} onClick={() => void login()}>Google로 로그인</button>}
      {session.state !== 'signed-out' && session.state !== 'checking' && <button className="feedback-secondary" disabled={busy} onClick={() => void logout()}>로그아웃</button>}
      {error && <p role="alert">{error}</p>}
    </section>}/>;
}
