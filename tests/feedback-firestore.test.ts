import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, setLogLevel, Timestamp, updateDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { createFirestoreAdminGateway, createFirestoreFeedbackGateway } from '../src/feedback-firebase';
import type { FeedbackDraft } from '../src/feedback';

const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8085';
const draft: FeedbackDraft = { nickname: '물리쌤', content: '전위 차이를 설명하기 좋아요.', kind: 'review', visibility: 'public' };
const dayNow = () => Math.floor((Date.now() + 32_400_000) / 86_400_000);
let env: RulesTestEnvironment;
const userDb = (uid: string) => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore() as unknown as Firestore;
const adminDb = () => env.authenticatedContext('teacher-admin', { firebase: { sign_in_provider: 'google.com' } }).firestore() as unknown as Firestore;
const gateway = (uid: string) => createFirestoreFeedbackGateway(userDb(uid), async () => uid);
const projection = (source: Record<string, unknown>) => Object.fromEntries(['nickname', 'content', 'kind', 'visibility', 'createdAt', 'updatedAt'].map(key => [key, source[key]]));
function proposed(db: Firestore, uid: string, overrides: Record<string, unknown> = {}) {
  const ref = doc(collection(db, 'feedbackPosts'));
  const data = { ...draft, authorUid: uid, createdAt: serverTimestamp(), updatedAt: null, deletedAt: null, quotaDay: dayNow(), quotaSlot: '1', ...overrides };
  const batch = writeBatch(db);
  batch.set(ref, data);
  batch.set(doc(db, 'feedbackQuotas', uid, 'days', String(data.quotaDay), 'slots', String(data.quotaSlot)), { postId: ref.id, createdAt: serverTimestamp() });
  if (data.visibility === 'public') batch.set(doc(db, 'feedbackPublic', ref.id), projection(data));
  return { ref, data, batch };
}
async function created(uid = 'alice', visibility: 'public' | 'private' = 'public') {
  const response = await gateway(uid).create({ ...draft, visibility });
  expect(response.ok, JSON.stringify(response)).toBe(true);
  if (!response.ok) throw new Error(response.code);
  return response.value;
}

describe.skipIf(!enabled)('DAT-005: real Firestore rules and adapter (isolated demo emulator)', () => {
  beforeAll(async () => {
    setLogLevel('silent'); // Expected denied attacks must not flood the test output.
    env = await initializeTestEnvironment({ projectId: 'demo-circuit-feedback', firestore: { host: '127.0.0.1', port: 8085, rules: await readFile('firestore.rules', 'utf8') } });
  }, 30_000);
  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async context => { await setDoc(doc(context.firestore() as unknown as Firestore, 'feedbackAdmins', 'teacher-admin'), { enabled: true }); });
  });
  afterAll(async () => env?.cleanup());

  it('allows real public/mine queries, keeps UID private, edits both copies and retains deletion for admin', async () => {
    const post = await created();
    const alice = gateway('alice'); const bob = gateway('bob');
    const publicList = await bob.list({ scope: 'public' });
    expect(publicList).toMatchObject({ ok: true, value: { posts: [{ id: post.id, canManage: false }] } });
    expect(await alice.list({ scope: 'public' })).toMatchObject({ ok: true, value: { posts: [{ canManage: true }] } });
    const publicData = (await getDoc(doc(userDb('bob'), 'feedbackPublic', post.id))).data()!;
    expect(Object.keys(publicData).sort()).toEqual(['content', 'createdAt', 'kind', 'nickname', 'updatedAt', 'visibility']);
    expect(await alice.update({ id: post.id, draft: { ...draft, content: '수정했어요', visibility: 'private' } })).toMatchObject({ ok: true });
    expect(await bob.list({ scope: 'public' })).toMatchObject({ ok: true, value: { posts: [] } });
    expect(await alice.list({ scope: 'mine' })).toMatchObject({ ok: true, value: { posts: [{ content: '수정했어요', visibility: 'private' }] } });
    expect(await alice.update({ id: post.id, draft })).toMatchObject({ ok: true });
    expect(await alice.remove({ id: post.id })).toMatchObject({ ok: true });
    expect(await alice.list({ scope: 'mine' })).toMatchObject({ ok: true, value: { posts: [] } });
    const retained = await createFirestoreAdminGateway(adminDb()).list();
    expect(retained).toMatchObject({ ok: true, value: [{ id: post.id, content: draft.content, deletedAt: expect.any(String) }] });
    await assertFails(getDoc(doc(userDb('alice'), 'feedbackPosts', post.id)));
    await assertFails(updateDoc(doc(userDb('alice'), 'feedbackPosts', post.id), { deletedAt: null, updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(adminDb(), 'feedbackPosts', post.id)));
  });
  it('denies guest access, private cross-user reads, broad source queries and arbitrary writes', async () => {
    const post = await created('alice', 'private');
    const guest = env.unauthenticatedContext().firestore() as unknown as Firestore;
    await assertFails(getDocs(collection(guest, 'feedbackPublic')));
    await assertFails(getDocs(collection(userDb('bob'), 'feedbackPosts')));
    await assertFails(getDoc(doc(userDb('bob'), 'feedbackPosts', post.id)));
    await assertFails(updateDoc(doc(userDb('bob'), 'feedbackPosts', post.id), { content: 'stolen', updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(userDb('bob'), 'feedbackPosts', post.id)));
    await assertFails(setDoc(doc(userDb('alice'), 'feedbackAdmins', 'alice'), { enabled: true }));
    await assertFails(getDoc(doc(userDb('bob'), 'feedbackAdmins', 'teacher-admin')));
    expect(await createFirestoreAdminGateway(userDb('bob')).list()).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await createFirestoreAdminGateway(userDb('teacher-admin')).list()).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });
  it('enforces exactly three creations under concurrency and never refunds deleted slots', async () => {
    const port = gateway('alice');
    const results = await Promise.all(Array.from({ length: 6 }, () => port.create({ ...draft, visibility: 'private' })));
    const successes = results.filter(result => result.ok);
    expect(successes, JSON.stringify(results)).toHaveLength(3);
    expect(results.filter(result => !result.ok)).toEqual(Array.from({ length: 3 }, () => ({ ok: false, code: 'DAILY_LIMIT' })));
    if (successes[0].ok) await port.remove({ id: successes[0].value.id });
    expect(await port.create(draft)).toEqual({ ok: false, code: 'DAILY_LIMIT' });
  }, 30_000);
  it.each([
    { authorUid: 'bob' }, { nickname: '' }, { nickname: 'x'.repeat(21) }, { content: 'x'.repeat(2001) },
    { content: 17 }, { kind: 'admin' }, { visibility: 'unknown' }, { extraData: true },
    { createdAt: Timestamp.fromMillis(0) }, { createdAt: 'today' }, { updatedAt: serverTimestamp() },
    { deletedAt: serverTimestamp() }, { quotaSlot: '4' }, { quotaSlot: '-1' },
    { quotaDay: dayNow() - 1 }, { quotaDay: dayNow() + 1 }, { quotaDay: 999999999999 },
  ])('rejects malformed or forged creates: %j', async overrides => {
    await assertFails(proposed(userDb('alice'), 'alice', overrides).batch.commit());
  });
  it('rejects missing required fields and malformed updates including ownership and immutable timestamps', async () => {
    const db = userDb('alice');
    const missing = proposed(db, 'alice');
    const { nickname: _nickname, ...withoutNickname } = missing.data;
    missing.batch.set(missing.ref, withoutNickname);
    await assertFails(missing.batch.commit());
    const post = await created('alice', 'private');
    const ref = doc(db, 'feedbackPosts', post.id);
    for (const changes of [{ authorUid: 'bob' }, { content: 'x'.repeat(2001) }, { content: 1 }, { extra: true }, { kind: 'bad' }, { createdAt: serverTimestamp() }, { quotaSlot: '2' }]) {
      await assertFails(updateDoc(ref, { ...changes, updatedAt: serverTimestamp() }));
    }
    const old = (await getDoc(ref)).data()!;
    const { content: _content, ...withoutContent } = old;
    await assertFails(setDoc(ref, { ...withoutContent, updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(ref));
  });
  it('rejects orphan projections, leaks, desynchronization and removal of an active public copy', async () => {
    const db = userDb('alice'); const post = await created();
    const ref = doc(db, 'feedbackPosts', post.id); const publicRef = doc(db, 'feedbackPublic', post.id);
    await assertFails(updateDoc(ref, { visibility: 'private', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { deletedAt: serverTimestamp() }));
    await assertFails(updateDoc(publicRef, { authorUid: 'alice' }));
    await assertFails(updateDoc(publicRef, { content: 'forged' }));
    await assertFails(deleteDoc(publicRef));
    await assertFails(setDoc(doc(collection(db, 'feedbackPublic')), { ...draft, createdAt: serverTimestamp(), updatedAt: null }));
    const noProjection = proposed(db, 'alice', { quotaSlot: '2' });
    noProjection.batch.delete(doc(db, 'feedbackPublic', noProjection.ref.id));
    await assertFails(noProjection.batch.commit());
  });
  it('rejects slot replay, unpaired slots and using a single slot for multiple posts in one batch', async () => {
    const db = userDb('alice');
    const first = proposed(db, 'alice', { visibility: 'private' });
    const second = doc(collection(db, 'feedbackPosts'));
    first.batch.set(second, first.data);
    await assertFails(first.batch.commit());
    const unpaired = doc(db, 'feedbackQuotas', 'alice', 'days', String(dayNow()), 'slots', '1');
    await assertFails(setDoc(unpaired, { postId: second.id, createdAt: serverTimestamp() }));
    await created('alice', 'private');
    await assertFails(proposed(db, 'alice', { visibility: 'private' }).batch.commit());
    await assertFails(deleteDoc(unpaired));
    await assertFails(updateDoc(unpaired, { postId: second.id }));
    await assertFails(getDoc(doc(userDb('bob'), 'feedbackQuotas', 'alice', 'days', String(dayNow()), 'slots', '1')));
  });
  it('paginates equal timestamps deterministically and validates cursor scope', async () => {
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore() as unknown as Firestore;
      const batch = writeBatch(db);
      for (let index = 0; index < 23; index++) batch.set(doc(db, 'feedbackPublic', String(index).padStart(20, '0')), { ...draft, createdAt: Timestamp.fromMillis(12345678), updatedAt: null });
      await batch.commit();
    });
    const first = await gateway('bob').list({ scope: 'public' });
    if (!first.ok) throw new Error(first.code);
    expect(first.value.posts).toHaveLength(20);
    const second = await gateway('bob').list({ scope: 'public', cursor: first.value.nextCursor! });
    if (!second.ok) throw new Error(second.code);
    expect(second.value.posts).toHaveLength(3);
    expect(new Set([...first.value.posts, ...second.value.posts].map(post => post.id)).size).toBe(23);
    expect(await gateway('bob').list({ scope: 'mine', cursor: first.value.nextCursor! })).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
  });
});
