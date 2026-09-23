import { getApps, initializeApp } from 'firebase/app';
import { browserLocalPersistence, browserPopupRedirectResolver, initializeAuth, signInAnonymously, type Auth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { firebaseConfig } from './config';

function client(name: string, admin = false) {
  const app = getApps().find(item => item.name === name) ?? initializeApp(firebaseConfig, name);
  const auth = initializeAuth(app, {
    persistence: browserLocalPersistence,
    ...(admin ? { popupRedirectResolver: browserPopupRedirectResolver } : {}),
  });
  return { auth, db: getFirestore(app) };
}
let board: ReturnType<typeof client> | undefined;
let admin: ReturnType<typeof client> | undefined;
export const boardClient = () => board ??= client('feedback-browser');
export const adminClient = () => admin ??= client('feedback-admin', true);
const pending = new WeakMap<Auth, Promise<string>>();
export function anonymousUid(auth: Auth): Promise<string> {
  const previous = pending.get(auth);
  if (previous) return previous;
  const request = (async () => {
    await auth.authStateReady();
    if (auth.currentUser) {
      if (!auth.currentUser.isAnonymous) throw new Error('unexpected-auth-provider');
      return auth.currentUser.uid;
    }
    // Serialize first sign-in across tabs where Web Locks are supported.
    const signIn = async () => {
      await auth.authStateReady();
      return auth.currentUser?.uid ?? (await signInAnonymously(auth)).user.uid;
    };
    return typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request('circuit-feedback-auth', signIn) : signIn();
  })();
  pending.set(auth, request);
  void request.finally(() => pending.delete(auth)).catch(() => {});
  return request;
}
