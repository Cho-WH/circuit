import {
  collection, doc, documentId, getDocFromServer, getDocs, limit, orderBy, query, runTransaction,
  serverTimestamp, startAfter, Timestamp, where,
  type DocumentData, type Firestore, type QueryConstraint,
} from 'firebase/firestore';
import {
  feedbackLimits, validFeedbackDraft,
  type FeedbackDraft, type FeedbackError, type FeedbackGateway, type FeedbackResult,
} from '../feedback';
import { anonymousUid, boardClient } from './client';

const DAY_MS = 86_400_000;
export const quotaDay = (time: number) => Math.floor((time + 9 * 3_600_000) / DAY_MS);
const clean = (draft: FeedbackDraft): FeedbackDraft => ({
  nickname: draft.nickname.trim(), content: draft.content.trim(), kind: draft.kind, visibility: draft.visibility,
});
export function entry(id: string, data: DocumentData) {
  return {
    id, nickname: data.nickname as string, content: data.content as string,
    kind: data.kind as FeedbackDraft['kind'], visibility: data.visibility as FeedbackDraft['visibility'],
    createdAt: (data.createdAt as Timestamp).toDate().toISOString(),
    updatedAt: data.updatedAt ? (data.updatedAt as Timestamp).toDate().toISOString() : null,
  };
}
class Rejection extends Error {
  constructor(readonly reason: FeedbackError) { super(reason); }
}
export async function result<T>(work: () => Promise<T>): Promise<FeedbackResult<T>> {
  try { return { ok: true, value: await work() }; }
  catch (error) {
    if (error instanceof Rejection) return { ok: false, code: error.reason };
    const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
    return { ok: false, code: code === 'permission-denied' ? 'FORBIDDEN' : 'UNAVAILABLE' };
  }
}
function publicFields(data: DocumentData) {
  return { nickname: data.nickname, content: data.content, kind: data.kind, visibility: data.visibility, createdAt: data.createdAt, updatedAt: data.updatedAt };
}
function cursorConstraints(value: string | undefined, scope: string): QueryConstraint[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (parsed.scope !== scope || !Number.isInteger(parsed.seconds) || !Number.isInteger(parsed.nanoseconds)
      || parsed.nanoseconds < 0 || parsed.nanoseconds >= 1e9 || typeof parsed.id !== 'string' || !/^[A-Za-z0-9]{20}$/.test(parsed.id)) throw new Error();
    return [startAfter(new Timestamp(parsed.seconds, parsed.nanoseconds), parsed.id)];
  } catch { throw new Rejection('INVALID_INPUT'); }
}

/** Injectable identity/database keep emulator tests on the same production adapter. */
export function createFirestoreFeedbackGateway(db: Firestore, identity: () => Promise<string>): FeedbackGateway {
  return {
    list: ({ scope, cursor }) => result(async () => {
      const uid = await identity();
      const ownFilters = [where('authorUid', '==', uid), where('deletedAt', '==', null)];
      const snapshot = await getDocs(query(collection(db, scope === 'mine' ? 'feedbackPosts' : 'feedbackPublic'),
        ...(scope === 'mine' ? ownFilters : []), orderBy('createdAt', 'desc'), orderBy(documentId(), 'desc'),
        ...cursorConstraints(cursor, scope), limit(feedbackLimits.pageSize)));
      // Owner-filtered timestamp range avoids document-ID queries being evaluated as
      // individual document reads. Three daily quota slots bound timestamp ties.
      const owned = scope === 'public' && snapshot.size > 0
        ? new Set((await getDocs(query(collection(db, 'feedbackPosts'), ...ownFilters, where('visibility', '==', 'public'),
          where('createdAt', '>=', snapshot.docs.at(-1)!.data().createdAt), where('createdAt', '<=', snapshot.docs[0].data().createdAt),
          orderBy('createdAt', 'desc'), orderBy(documentId(), 'desc'), limit(feedbackLimits.pageSize + 2 * feedbackLimits.daily)))).docs.map(item => item.id))
        : new Set(snapshot.docs.map(item => item.id));
      const last = snapshot.docs.at(-1);
      const stamp = last?.data().createdAt as Timestamp | undefined;
      return {
        posts: snapshot.docs.map(item => ({ ...entry(item.id, item.data()), canManage: owned.has(item.id) })),
        nextCursor: snapshot.size === feedbackLimits.pageSize && last && stamp
          ? JSON.stringify({ scope, seconds: stamp.seconds, nanoseconds: stamp.nanoseconds, id: last.id }) : null,
      };
    }),
    create: draft => result(async () => {
      if (!validFeedbackDraft(draft)) throw new Rejection('INVALID_INPUT');
      const uid = await identity();
      const post = doc(collection(db, 'feedbackPosts'));
      const day = quotaDay(Date.now());
      const slots = ['1', '2', '3'].map(slot => doc(db, 'feedbackQuotas', uid, 'days', String(day), 'slots', slot));
      // Rules may reject a raced immutable slot before Firestore reports ABORTED.
      // Retry only when that exact slot has since been claimed by another post.
      for (let attempt = 0; ; attempt++) {
        let selectedSlot = -1;
        try {
          await runTransaction(db, async transaction => {
            const snapshots = await Promise.all(slots.map(slot => transaction.get(slot)));
            const index = snapshots.findIndex(slot => !slot.exists());
            if (index < 0) throw new Rejection('DAILY_LIMIT');
            selectedSlot = index;
            const data = { ...clean(draft), authorUid: uid, createdAt: serverTimestamp(), updatedAt: null, deletedAt: null, quotaDay: day, quotaSlot: String(index + 1) };
            transaction.set(slots[index], { postId: post.id, createdAt: serverTimestamp() });
            transaction.set(post, data);
            if (draft.visibility === 'public') transaction.set(doc(db, 'feedbackPublic', post.id), publicFields(data));
          });
          break;
        }
        catch (error) {
          if (attempt >= 3 || selectedSlot < 0 || !error || typeof error !== 'object' || !('code' in error) || error.code !== 'permission-denied') throw error;
          const claimed = await getDocFromServer(slots[selectedSlot]);
          if (!claimed.exists() || claimed.data().postId === post.id) throw error;
        }
      }
      const saved = await getDocFromServer(post);
      return { ...entry(post.id, saved.data()!), canManage: true };
    }),
    update: ({ id, draft }) => result(async () => {
      if (!validFeedbackDraft(draft) || !/^[A-Za-z0-9]{20}$/.test(id)) throw new Rejection('INVALID_INPUT');
      const uid = await identity();
      const ref = doc(db, 'feedbackPosts', id);
      await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists() || snapshot.data().deletedAt !== null) throw new Rejection('NOT_FOUND');
        if (snapshot.data().authorUid !== uid) throw new Rejection('FORBIDDEN');
        const data = { ...snapshot.data(), ...clean(draft), updatedAt: serverTimestamp() };
        transaction.update(ref, data);
        const publicRef = doc(db, 'feedbackPublic', id);
        if (draft.visibility === 'public') transaction.set(publicRef, publicFields(data));
        else if (snapshot.data().visibility === 'public') transaction.delete(publicRef);
      });
      const saved = await getDocFromServer(ref);
      return { ...entry(id, saved.data()!), canManage: true };
    }),
    remove: ({ id }) => result(async () => {
      if (!/^[A-Za-z0-9]{20}$/.test(id)) throw new Rejection('INVALID_INPUT');
      const uid = await identity();
      await runTransaction(db, async transaction => {
        const ref = doc(db, 'feedbackPosts', id);
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists() || snapshot.data().deletedAt !== null) throw new Rejection('NOT_FOUND');
        if (snapshot.data().authorUid !== uid) throw new Rejection('FORBIDDEN');
        transaction.update(ref, { deletedAt: serverTimestamp() });
        if (snapshot.data().visibility === 'public') transaction.delete(doc(db, 'feedbackPublic', id));
      });
    }),
  };
}
let gateway: FeedbackGateway | undefined;
export function createFirebaseFeedbackGateway(): FeedbackGateway {
  if (!gateway) {
    const { auth, db } = boardClient();
    gateway = createFirestoreFeedbackGateway(db, () => anonymousUid(auth));
  }
  return gateway;
}
