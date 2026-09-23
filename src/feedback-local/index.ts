import { feedbackDay, feedbackLimits, validFeedbackDraft, type FeedbackPost, type AdminFeedbackPost, type FeedbackDraft, type FeedbackGateway, type FeedbackAdminGateway, type FeedbackResult } from '../feedback';

interface StoredPost extends AdminFeedbackPost { ownerId: string; salt: string; passwordHash: string }
interface Snapshot { version: 1; identity: string; posts: StoredPost[] }
interface LocalDependencies {
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  crypto: Crypto;
  now: () => Date;
  /** Must serialize all tabs and instances sharing the storage. */
  exclusive: <T>(task: () => Promise<T>) => Promise<T>;
}
const key = 'circuit.feedback.preview.v1';
const hex = (bytes: Uint8Array) => [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
const fail = <T>(code: 'UNAVAILABLE' | 'INVALID_INPUT' | 'DAILY_LIMIT' | 'INVALID_PASSWORD' | 'NOT_FOUND'): FeedbackResult<T> => ({ ok: false, code });
const ok = <T>(value: T): FeedbackResult<T> => ({ ok: true, value });
function publicPost(post: StoredPost): FeedbackPost {
  return { id: post.id, nickname: post.nickname, content: post.content, kind: post.kind, visibility: post.visibility, createdAt: post.createdAt };
}
function isSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object') return false;
  const data = value as Snapshot;
  return data.version === 1 && typeof data.identity === 'string' && Array.isArray(data.posts) && data.posts.every(post =>
    post && typeof post.id === 'string' && typeof post.ownerId === 'string' && typeof post.salt === 'string' && /^[a-f0-9]{32}$/.test(post.salt)
    && typeof post.passwordHash === 'string' && /^[a-f0-9]{64}$/.test(post.passwordHash)
    && typeof post.createdAt === 'string' && Number.isFinite(Date.parse(post.createdAt))
    && (post.deletedAt === null || typeof post.deletedAt === 'string' && Number.isFinite(Date.parse(post.deletedAt)))
    && validFeedbackDraft({ ...post, password: 'validation-only' }));
}

/** Local preview only: browser storage is not a security boundary. Never use as a public backend. */
export function createLocalFeedback(deps: LocalDependencies): { gateway: FeedbackGateway; admin: FeedbackAdminGateway } {
  function read(): Snapshot {
    const raw = deps.storage.getItem(key);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (!isSnapshot(parsed)) throw new Error('Invalid feedback preview snapshot');
      return parsed;
    }
    const initial: Snapshot = { version: 1, identity: deps.crypto.randomUUID(), posts: [] };
    deps.storage.setItem(key, JSON.stringify(initial));
    return initial;
  }
  async function guarded<T>(operation: (data: Snapshot) => Promise<FeedbackResult<T>>): Promise<FeedbackResult<T>> {
    try { return await deps.exclusive(() => operation(read())); } catch { return fail('UNAVAILABLE'); }
  }
  async function passwordHash(password: string, salt: string): Promise<string> {
    const material = await deps.crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await deps.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: 210000,
      salt: Uint8Array.from(salt.match(/../g)!, byte => parseInt(byte, 16)) }, material, 256);
    return hex(new Uint8Array(bits));
  }
  const gateway: FeedbackGateway = {
    list: ({ scope, cursor }) => guarded(async data => {
      if (scope !== 'public' && scope !== 'mine') return fail('INVALID_INPUT');
      const all = data.posts.filter(post => !post.deletedAt && (scope === 'public' ? post.visibility === 'public' : post.ownerId === data.identity))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      // Cursor carries the ordering key, so deleting the last post on a page cannot skip the next page.
      const following = cursor ? all.filter(post => `${post.createdAt}|${post.id}` < cursor) : all;
      const posts = following.slice(0, feedbackLimits.pageSize);
      const last = posts.at(-1);
      return ok({ posts: posts.map(publicPost), nextCursor: following.length > posts.length && last ? `${last.createdAt}|${last.id}` : null });
    }),
    create: (draft: FeedbackDraft) => guarded(async data => {
      if (!validFeedbackDraft(draft)) return fail('INVALID_INPUT');
      const now = deps.now();
      // Includes private and deleted posts. Deleting does not refund the daily quota.
      if (data.posts.filter(post => post.ownerId === data.identity && feedbackDay(new Date(post.createdAt)) === feedbackDay(now)).length >= feedbackLimits.daily) return fail('DAILY_LIMIT');
      const salt = hex(deps.crypto.getRandomValues(new Uint8Array(16)));
      const post: StoredPost = { id: deps.crypto.randomUUID(), ownerId: data.identity, nickname: draft.nickname.trim(), content: draft.content.trim(),
        kind: draft.kind, visibility: draft.visibility, createdAt: now.toISOString(), deletedAt: null, salt, passwordHash: await passwordHash(draft.password, salt) };
      data.posts.push(post);
      deps.storage.setItem(key, JSON.stringify(data));
      return ok(publicPost(post));
    }),
    remove: ({ id, password }) => guarded(async data => {
      const post = data.posts.find(item => item.id === id && !item.deletedAt);
      if (!post) return fail('NOT_FOUND');
      if (typeof password !== 'string' || password.length > feedbackLimits.passwordMax || await passwordHash(password, post.salt) !== post.passwordHash) return fail('INVALID_PASSWORD');
      post.deletedAt = deps.now().toISOString();
      deps.storage.setItem(key, JSON.stringify(data));
      return ok(undefined);
    }),
  };
  return { gateway, admin: { list: () => guarded(async data => ok([...data.posts].reverse().map(post => ({ ...publicPost(post), deletedAt: post.deletedAt })))) } };
}

export function createBrowserFeedbackPreview() {
  // Access globals only when requested. Storage failures surface as structured results.
  return createLocalFeedback({
    storage: { getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value) },
    crypto: globalThis.crypto, now: () => new Date(),
    exclusive: async task => {
      if (!navigator.locks) return Promise.reject(new Error('Web Locks unavailable'));
      return navigator.locks.request('circuit.feedback.preview', task);
    },
  });
}
