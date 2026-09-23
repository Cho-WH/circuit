import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createLocalFeedback } from '../src/feedback-local';
import { feedbackDay, type FeedbackDraft, type FeedbackResult } from '../src/feedback';

const draft: FeedbackDraft = { nickname: '물리쌤', content: '전위 차이를 설명하기 편했어요.', kind: 'review', visibility: 'public', password: 'test-password' };
function value<T>(result: FeedbackResult<T>): T { if (!result.ok) throw new Error(result.code); return result.value; }
function setup() {
  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
  let clock = new Date('2026-09-23T14:59:00Z');
  let queue: Promise<unknown> = Promise.resolve();
  const deps = { storage, crypto: webcrypto as unknown as Crypto, now: () => clock,
    exclusive: <T>(task: () => Promise<T>): Promise<T> => { const work = queue.then(task); queue = work.catch(() => {}); return work; } };
  return { ...createLocalFeedback(deps), store, deps, setTime: (time: string) => { clock = new Date(time); } };
}

describe('DAT-005: feedback adapter contract', () => {
  it('does not expose private bodies, credentials or identity through the public API', async () => {
    const { gateway } = setup();
    const created = value(await gateway.create(draft));
    await gateway.create({ ...draft, content: '비공개 내용', visibility: 'private' });
    const publicPage = value(await gateway.list({ scope: 'public' }));
    expect(publicPage.posts).toEqual([created]);
    expect(Object.keys(created).sort()).toEqual(['content', 'createdAt', 'id', 'kind', 'nickname', 'visibility']);
    expect(value(await gateway.list({ scope: 'mine' })).posts).toHaveLength(2);
  });
  it('hashes passwords with unique salts and keeps deletion records only in the admin view', async () => {
    const { gateway, adminPreview, store } = setup();
    const first = value(await gateway.create(draft));
    await gateway.create(draft);
    const raw = [...store.values()][0];
    expect(raw).not.toContain(draft.password);
    const stored = JSON.parse(raw).posts;
    expect(stored[0].passwordHash).not.toBe(stored[1].passwordHash);
    expect(await gateway.remove({ id: first.id, password: 'wrong' })).toEqual({ ok: false, code: 'INVALID_PASSWORD' });
    expect(value(await gateway.list({ scope: 'public' })).posts).toHaveLength(2);
    expect(await gateway.remove({ id: first.id, password: draft.password })).toEqual({ ok: true, value: undefined });
    expect(value(await gateway.list({ scope: 'public' })).posts.map(post => post.id)).not.toContain(first.id);
    expect(value(await gateway.list({ scope: 'mine' })).posts.map(post => post.id)).not.toContain(first.id);
    expect(value(await adminPreview.list()).find(post => post.id === first.id)).toEqual({ ...first, deletedAt: '2026-09-23T14:59:00.000Z' });
    expect(await gateway.remove({ id: first.id, password: draft.password })).toEqual({ ok: false, code: 'NOT_FOUND' });
  });
  it('enforces the quota across parallel calls, private posts, reloads and deletion', async () => {
    const { gateway, deps } = setup();
    const otherTab = createLocalFeedback(deps).gateway;
    const results = await Promise.all([gateway.create(draft), otherTab.create({ ...draft, visibility: 'private' }), gateway.create(draft), otherTab.create(draft)]);
    expect(results.filter(result => result.ok)).toHaveLength(3);
    expect(results[3]).toEqual({ ok: false, code: 'DAILY_LIMIT' });
    await gateway.remove({ id: value(results[0]).id, password: draft.password });
    expect(await createLocalFeedback(deps).gateway.create(draft)).toEqual({ ok: false, code: 'DAILY_LIMIT' });
  });
  it('resets at Korea midnight and keeps earlier records', async () => {
    const { gateway, setTime, adminPreview } = setup();
    await Promise.all([gateway.create(draft), gateway.create(draft), gateway.create(draft)]);
    setTime('2026-09-23T15:00:00Z');
    expect(feedbackDay(new Date('2026-09-23T15:00:00Z'))).toBe('2026-09-24');
    expect((await gateway.create(draft)).ok).toBe(true);
    expect(value(await adminPreview.list())).toHaveLength(4);
  });
  it('uses identity only for the mine view and requires the password even for the owner', async () => {
    const { gateway, store } = setup();
    const post = value(await gateway.create(draft));
    await gateway.create({ ...draft, visibility: 'private' });
    const key = [...store.keys()][0];
    const snapshot = JSON.parse(store.get(key)!); snapshot.identity = 'another-browser'; store.set(key, JSON.stringify(snapshot));
    expect(value(await gateway.list({ scope: 'mine' })).posts).toEqual([]);
    expect(value(await gateway.list({ scope: 'public' })).posts).toHaveLength(1);
    expect((await gateway.remove({ id: post.id, password: draft.password })).ok).toBe(true);
  });
  it.each([{ nickname: ' ' }, { content: ' ' }, { password: '   ' }, { password: 'abc' }, { content: 'a'.repeat(2001) }, { nickname: 'a'.repeat(21) }, { visibility: 'unknown' }])('rejects invalid input without consuming quota: %j', async change => {
    const { gateway, adminPreview } = setup();
    expect(await gateway.create({ ...draft, ...change } as FeedbackDraft)).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(value(await adminPreview.list())).toEqual([]);
  });
  it('surfaces corrupt storage without overwriting it', async () => {
    const { gateway, store } = setup();
    await gateway.list({ scope: 'public' });
    const key = [...store.keys()][0]; store.set(key, '{broken');
    expect(await gateway.create(draft)).toEqual({ ok: false, code: 'UNAVAILABLE' });
    expect(store.get(key)).toBe('{broken');
  });
  it('reports failed persistence without claiming success', async () => {
    const { gateway, deps } = setup();
    await gateway.list({ scope: 'public' });
    const failing = createLocalFeedback({ ...deps, storage: { ...deps.storage, setItem: () => { throw new Error('QuotaExceededError'); } } });
    expect(await failing.gateway.create(draft)).toEqual({ ok: false, code: 'UNAVAILABLE' });
    expect(value(await gateway.list({ scope: 'mine' })).posts).toEqual([]);
  });
  it('paginates without duplicates when the preceding cursor post is deleted', async () => {
    const { gateway, setTime } = setup();
    for (let day = 1; day <= 8; day++) {
      setTime(`2026-09-${String(day).padStart(2, '0')}T00:00:00Z`);
      await gateway.create(draft); await gateway.create(draft); await gateway.create(draft);
    }
    const first = value(await gateway.list({ scope: 'public' }));
    expect(first.posts).toHaveLength(20);
    await gateway.remove({ id: first.posts.at(-1)!.id, password: draft.password });
    const second = value(await gateway.list({ scope: 'public', cursor: first.nextCursor! }));
    expect(second.posts).toHaveLength(4);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.posts, ...second.posts].map(post => post.id)).size).toBe(24);
  });
});
