import { webcrypto } from 'node:crypto';
import legacy from './fixtures/feedback-v1.json';
import { describe, expect, it } from 'vitest';
import { createLocalFeedback } from '../src/feedback-local';
import { feedbackDay, type FeedbackDraft, type FeedbackResult } from '../src/feedback';

const draft: FeedbackDraft = { nickname: '물리쌤', content: '전위 차이를 설명하기 편했어요.', kind: 'review', visibility: 'public' };
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
  it('edits all content fields and visibility without changing ownership, order or quota', async () => {
    const { gateway, deps, setTime } = setup();
    const original = value(await gateway.create(draft));
    await gateway.create(draft); await gateway.create(draft);
    setTime('2026-09-23T14:59:30Z');
    const edited = value(await gateway.update({ id: original.id, draft: { ...draft, nickname: ' 새 별명 ', content: ' 새 내용 ', kind: 'idea', visibility: 'private', ownerId: 'injected', createdAt: '2000-01-01', deletedAt: 'fake' } as FeedbackDraft }));
    expect(edited).toEqual({ ...original, nickname: '새 별명', content: '새 내용', kind: 'idea', visibility: 'private', updatedAt: '2026-09-23T14:59:30.000Z' });
    expect(value(await gateway.list({ scope: 'public' })).posts).toHaveLength(2);
    expect(value(await createLocalFeedback(deps).gateway.list({ scope: 'mine' })).posts.find(post => post.id === original.id)).toEqual(edited);
    expect(await gateway.create(draft)).toEqual({ ok: false, code: 'DAILY_LIMIT' });
    await gateway.update({ id: original.id, draft });
    expect(value(await gateway.list({ scope: 'public' })).posts).toHaveLength(3);
  });
  it('migrates the v1 fixture once, preserving ownership, private/deleted records and quota', async () => {
    const { gateway, admin, store } = setup();
    const source = JSON.stringify(legacy); store.set('circuit.feedback.preview.v1', source);
    expect(value(await gateway.list({ scope: 'mine' })).posts.map(post => post.id)).toEqual(['own']);
    expect(value(await gateway.list({ scope: 'public' })).posts[0].canManage).toBe(false);
    expect(value(await admin.list()).find(post => post.id === 'deleted')?.content).toBe('보존할 삭제 원문');
    expect(store.get('circuit.feedback.preview.v1')).toBe(source);
    const migrated = store.get('circuit.feedback.preview.v2')!;
    expect(migrated).not.toMatch(/passwordHash|salt/);
    expect(JSON.parse(migrated).identity).toBe('original-browser');
    expect((await gateway.update({ id: 'own', draft })).ok).toBe(true);
    expect(await gateway.update({ id: 'other', draft })).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect((await gateway.create(draft)).ok).toBe(true);
    expect(await gateway.create(draft)).toEqual({ ok: false, code: 'DAILY_LIMIT' });
    expect(value(await gateway.list({ scope: 'mine' })).posts.find(post => post.id === 'own')?.content).toBe(draft.content);
  });
  it('does not replace corrupt or future v2 data with the legacy copy', async () => {
    const { gateway, store } = setup();
    store.set('circuit.feedback.preview.v1', JSON.stringify(legacy));
    store.set('circuit.feedback.preview.v2', '{broken');
    expect(await gateway.list({ scope: 'public' })).toEqual({ ok: false, code: 'UNAVAILABLE' });
    expect(store.get('circuit.feedback.preview.v2')).toBe('{broken');
    store.set('circuit.feedback.preview.v2', JSON.stringify({ ...legacy, version: 3 }));
    expect(await gateway.list({ scope: 'public' })).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it('rejects an empty edit and leaves the stored record intact', async () => {
    const { gateway } = setup();
    const post = value(await gateway.create(draft));
    expect(await gateway.update({ id: post.id, draft: { ...draft, content: ' ' } })).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(value(await gateway.list({ scope: 'mine' })).posts).toEqual([post]);
  });
  it('does not expose private bodies, credentials or identity through the public API', async () => {
    const { gateway } = setup();
    const created = value(await gateway.create(draft));
    await gateway.create({ ...draft, content: '비공개 내용', visibility: 'private' });
    const publicPage = value(await gateway.list({ scope: 'public' }));
    expect(publicPage.posts).toEqual([created]);
    expect(Object.keys(created).sort()).toEqual(['canManage', 'content', 'createdAt', 'id', 'kind', 'nickname', 'updatedAt', 'visibility']);
    expect(value(await gateway.list({ scope: 'mine' })).posts).toHaveLength(2);
  });
  it('soft-deletes owned posts and retains the final content only for admins', async () => {
    const { gateway, admin } = setup();
    const first = value(await gateway.create(draft));
    expect(first.canManage).toBe(true);
    await gateway.update({ id: first.id, draft: { ...draft, content: '수정한 원문' } });
    expect(await gateway.remove({ id: first.id })).toEqual({ ok: true, value: undefined });
    expect(value(await gateway.list({ scope: 'public' })).posts).toEqual([]);
    expect(value(await gateway.list({ scope: 'mine' })).posts).toEqual([]);
    expect(value(await admin.list())[0]).toMatchObject({ id: first.id, content: '수정한 원문', deletedAt: '2026-09-23T14:59:00.000Z' });
    expect(value(await admin.list())[0]).not.toHaveProperty('canManage');
    expect(await gateway.remove({ id: first.id })).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(await gateway.update({ id: first.id, draft })).toEqual({ ok: false, code: 'NOT_FOUND' });
  });
  it('enforces the quota across parallel calls, private posts, reloads and deletion', async () => {
    const { gateway, deps } = setup();
    const otherTab = createLocalFeedback(deps).gateway;
    const results = await Promise.all([gateway.create(draft), otherTab.create({ ...draft, visibility: 'private' }), gateway.create(draft), otherTab.create(draft)]);
    expect(results.filter(result => result.ok)).toHaveLength(3);
    expect(results[3]).toEqual({ ok: false, code: 'DAILY_LIMIT' });
    await gateway.remove({ id: value(results[0]).id });
    expect(await createLocalFeedback(deps).gateway.create(draft)).toEqual({ ok: false, code: 'DAILY_LIMIT' });
  });
  it('resets at Korea midnight and keeps earlier records', async () => {
    const { gateway, setTime, admin } = setup();
    await Promise.all([gateway.create(draft), gateway.create(draft), gateway.create(draft)]);
    setTime('2026-09-23T15:00:00Z');
    expect(feedbackDay(new Date('2026-09-23T15:00:00Z'))).toBe('2026-09-24');
    expect((await gateway.create(draft)).ok).toBe(true);
    expect(value(await admin.list())).toHaveLength(4);
  });
  it('rejects both mutations from another browser, even if UI hints or owner fields are forged', async () => {
    const { gateway, store } = setup();
    const post = value(await gateway.create(draft));
    await gateway.create({ ...draft, visibility: 'private' });
    const key = [...store.keys()][0];
    const snapshot = JSON.parse(store.get(key)!); snapshot.identity = 'another-browser'; store.set(key, JSON.stringify(snapshot));
    expect(value(await gateway.list({ scope: 'mine' })).posts).toEqual([]);
    expect(value(await gateway.list({ scope: 'public' })).posts).toHaveLength(1);
    expect(value(await gateway.list({ scope: 'public' })).posts[0].canManage).toBe(false);
    expect(await gateway.remove({ id: post.id })).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(await gateway.update({ id: post.id, draft: { ...draft, ownerId: 'another-browser', canManage: true } as FeedbackDraft })).toEqual({ ok: false, code: 'FORBIDDEN' });
  });
  it.each([{ nickname: ' ' }, { content: ' ' }, { content: 'a'.repeat(2001) }, { nickname: 'a'.repeat(21) }, { visibility: 'unknown' }])('rejects invalid input without consuming quota: %j', async change => {
    const { gateway, admin } = setup();
    expect(await gateway.create({ ...draft, ...change } as FeedbackDraft)).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(value(await admin.list())).toEqual([]);
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
    await gateway.remove({ id: first.posts.at(-1)!.id });
    const second = value(await gateway.list({ scope: 'public', cursor: first.nextCursor! }));
    expect(second.posts).toHaveLength(4);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.posts, ...second.posts].map(post => post.id)).size).toBe(24);
  });
});
