import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { collection, doc, documentId, getDocFromServer, getDocs, limit, orderBy, query, startAfter, runTransaction, serverTimestamp, type Firestore, type QueryDocumentSnapshot } from 'firebase/firestore';
import { validFeedbackReply, type AdminFeedbackPost, type FeedbackAdminGateway } from '../feedback';
import { adminClient } from './client';
import { entry, result, publicFields, Rejection } from './gateway';

export type AdminSession =
  | { state: 'checking' | 'signed-out' | 'error' }
  | { state: 'authorized' | 'forbidden'; uid: string };
export function createFirestoreAdminGateway(db: Firestore): FeedbackAdminGateway {
  return { list: () => result(async () => {
    const posts: AdminFeedbackPost[] = [];
    let cursor: QueryDocumentSnapshot | undefined;
    do {
      const snapshot = await getDocs(query(collection(db, 'feedbackPosts'), orderBy('createdAt', 'desc'), orderBy(documentId(), 'desc'),
        ...(cursor ? [startAfter(cursor)] : []), limit(100)));
      posts.push(...snapshot.docs.map(item => ({ ...entry(item.id, item.data()), deletedAt: item.data().deletedAt?.toDate().toISOString() ?? null })));
      cursor = snapshot.size === 100 ? snapshot.docs.at(-1) : undefined;
    } while (cursor);
    return posts;
  }), saveReply: ({ id, content }) => result(async () => {
    if (!/^[A-Za-z0-9]{20}$/.test(id) || !validFeedbackReply(content)) throw new Rejection('INVALID_INPUT');
    const ref = doc(db, 'feedbackPosts', id);
    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists() || snapshot.data().deletedAt !== null) throw new Rejection('NOT_FOUND');
      const data = { ...snapshot.data(), reply: { content: content.trim(), updatedAt: serverTimestamp() } };
      transaction.update(ref, { reply: data.reply });
      if (snapshot.data().visibility === 'public') transaction.set(doc(db, 'feedbackPublic', id), publicFields(data));
    });
    const saved = await getDocFromServer(ref);
    return entry(id, saved.data()!).reply!;
  }) };
}
export function createFirebaseAdminAccess() {
  const { auth, db } = adminClient();
  return {
    gateway: createFirestoreAdminGateway(db),
    subscribe(listener: (session: AdminSession) => void) {
      let generation = 0;
      let stopped = false;
      const unsubscribe = onAuthStateChanged(auth, user => {
        const revision = ++generation;
        if (!user) { listener({ state: 'signed-out' }); return; }
        listener({ state: 'checking' });
        void (async () => {
          try {
            const access = await getDocFromServer(doc(db, 'feedbackAdmins', user.uid));
            if (!stopped && revision === generation) listener({ state: access.data()?.enabled === true ? 'authorized' : 'forbidden', uid: user.uid });
          } catch { if (!stopped && revision === generation) listener({ state: 'error' }); }
        })();
      });
      return () => { stopped = true; generation++; unsubscribe(); };
    },
    async signIn() {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    },
    signOut: () => signOut(auth),
  };
}
