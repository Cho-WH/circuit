import { feedbackDay, feedbackLimits, validFeedbackDraft, type FeedbackEntry, type FeedbackPost, type AdminFeedbackPost, type FeedbackDraft, type FeedbackGateway, type FeedbackAdminGateway, type FeedbackResult, type FeedbackError } from '../feedback';

interface StoredPost extends AdminFeedbackPost { ownerId: string }
interface Snapshot { version: 2; identity: string; posts: StoredPost[] }
interface LocalDependencies {
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  crypto: Pick<Crypto, 'randomUUID'>;
  now: () => Date;
  /** Must serialize all tabs and instances sharing the storage. */
  exclusive: <T>(task: () => Promise<T>) => Promise<T>;
}
const key = 'circuit.feedback.preview.v2';
const legacyKey = 'circuit.feedback.preview.v1';
const fail = <T>(code: FeedbackError): FeedbackResult<T> => ({ ok: false, code });
const ok = <T>(value: T): FeedbackResult<T> => ({ ok: true, value });
function entry(post: StoredPost): FeedbackEntry {
  return { id: post.id, nickname: post.nickname, content: post.content, kind: post.kind, visibility: post.visibility, createdAt: post.createdAt, updatedAt: post.updatedAt };
}
function publicPost(post: StoredPost, identity: string): FeedbackPost {
  return { ...entry(post), canManage: post.ownerId === identity && post.deletedAt === null };
}
const validDate = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
/** v1 -> v2 retains ownership and content, but drops all password verification material. */
function readSnapshot(value: unknown): Snapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid snapshot');
  const data = value as { version: number; identity: string; posts: StoredPost[] };
  if (![1, 2].includes(data.version) || typeof data.identity !== 'string' || !data.identity || !Array.isArray(data.posts)) throw new Error('Invalid snapshot');
  const ids = new Set<string>();
  const posts = data.posts.map(post => {
    if (!post || typeof post.id !== 'string' || ids.has(post.id) || typeof post.ownerId !== 'string' || !post.ownerId
      || !validDate(post.createdAt) || !(post.deletedAt === null || validDate(post.deletedAt))
      || (data.version === 2 && !(post.updatedAt === null || validDate(post.updatedAt))) || !validFeedbackDraft(post)) throw new Error('Invalid post');
    ids.add(post.id);
    return { ...entry({ ...post, updatedAt: data.version === 1 ? null : post.updatedAt }), ownerId: post.ownerId, deletedAt: post.deletedAt };
  });
  return { version: 2, identity: data.identity, posts };
}

/** Local preview only: browser storage is not a security boundary. */
export function createLocalFeedback(deps: LocalDependencies): { gateway: FeedbackGateway; admin: FeedbackAdminGateway } {
  function read(): Snapshot {
    const raw = deps.storage.getItem(key);
    if (raw !== null) return readSnapshot(JSON.parse(raw));
    const legacy = deps.storage.getItem(legacyKey);
    const initial: Snapshot = legacy === null ? { version: 2, identity: deps.crypto.randomUUID(), posts: [] } : readSnapshot(JSON.parse(legacy));
    // Preserve v1 as a recovery copy. All subsequent reads/writes use v2.
    deps.storage.setItem(key, JSON.stringify(initial));
    return initial;
  }
  async function guarded<T>(operation: (data: Snapshot) => Promise<FeedbackResult<T>>): Promise<FeedbackResult<T>> {
    try { return await deps.exclusive(() => operation(read())); } catch { return fail('UNAVAILABLE'); }
  }
  const fields = (draft: FeedbackDraft): FeedbackDraft => ({ nickname: draft.nickname.trim(), content: draft.content.trim(), kind: draft.kind, visibility: draft.visibility });
  const gateway: FeedbackGateway = {
    list: ({ scope, cursor }) => guarded(async data => {
      if (scope !== 'public' && scope !== 'mine') return fail('INVALID_INPUT');
      const all = data.posts.filter(post => !post.deletedAt && (scope === 'public' ? post.visibility === 'public' : post.ownerId === data.identity))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      const following = cursor ? all.filter(post => `${post.createdAt}|${post.id}` < cursor) : all;
      const posts = following.slice(0, feedbackLimits.pageSize);
      const last = posts.at(-1);
      return ok({ posts: posts.map(post => publicPost(post, data.identity)), nextCursor: following.length > posts.length && last ? `${last.createdAt}|${last.id}` : null });
    }),
    create: draft => guarded(async data => {
      if (!validFeedbackDraft(draft)) return fail('INVALID_INPUT');
      const now = deps.now();
      if (data.posts.filter(post => post.ownerId === data.identity && feedbackDay(new Date(post.createdAt)) === feedbackDay(now)).length >= feedbackLimits.daily) return fail('DAILY_LIMIT');
      const post: StoredPost = { ...fields(draft), id: deps.crypto.randomUUID(), ownerId: data.identity, createdAt: now.toISOString(), updatedAt: null, deletedAt: null };
      data.posts.push(post);
      deps.storage.setItem(key, JSON.stringify(data));
      return ok(publicPost(post, data.identity));
    }),
    update: ({ id, draft }) => guarded(async data => {
      const post = data.posts.find(item => item.id === id && !item.deletedAt);
      if (!post) return fail('NOT_FOUND');
      if (post.ownerId !== data.identity) return fail('FORBIDDEN');
      if (!validFeedbackDraft(draft)) return fail('INVALID_INPUT');
      Object.assign(post, fields(draft), { updatedAt: deps.now().toISOString() });
      deps.storage.setItem(key, JSON.stringify(data));
      return ok(publicPost(post, data.identity));
    }),
    remove: ({ id }) => guarded(async data => {
      const post = data.posts.find(item => item.id === id && !item.deletedAt);
      if (!post) return fail('NOT_FOUND');
      if (post.ownerId !== data.identity) return fail('FORBIDDEN');
      post.deletedAt = deps.now().toISOString();
      deps.storage.setItem(key, JSON.stringify(data));
      return ok(undefined);
    }),
  };
  return { gateway, admin: { list: () => guarded(async data => ok([...data.posts].reverse().map(post => ({ ...entry(post), deletedAt: post.deletedAt })))) } };
}

export function createBrowserFeedbackPreview() {
  return createLocalFeedback({
    storage: { getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value) },
    crypto: globalThis.crypto, now: () => new Date(),
    exclusive: async task => {
      if (!navigator.locks) return Promise.reject(new Error('Web Locks unavailable'));
      return navigator.locks.request('circuit.feedback.preview', task);
    },
  });
}
