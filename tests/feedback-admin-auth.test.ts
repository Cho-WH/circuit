// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AdminSession } from '../src/feedback-firebase';
import { FeedbackAdminApp } from '../src/app/FeedbackAdminPage';

const auth = vi.hoisted(() => ({
  listener: undefined as ((session: AdminSession) => void) | undefined,
  signIn: vi.fn<() => Promise<void>>(),
  list: vi.fn(async () => ({ ok: true, value: [] })),
}));
vi.mock('../src/feedback-firebase', () => ({
  createFirebaseAdminAccess: () => ({
    gateway: { list: auth.list },
    subscribe: (listener: (session: AdminSession) => void) => {
      auth.listener = listener;
      listener({ state: 'signed-out' });
      return () => { auth.listener = undefined; };
    },
    signIn: auth.signIn,
    signOut: async () => auth.listener?.({ state: 'signed-out' }),
  }),
}));
let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  auth.signIn.mockReset(); auth.list.mockClear();
  host = document.createElement('div'); document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(FeedbackAdminApp)));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function login() {
  const button = [...host.querySelectorAll('button')].find(item => item.textContent === 'Google로 로그인')!;
  await act(async () => button.click());
}
it('clears a previous popup error when authentication succeeds later', async () => {
  auth.signIn.mockRejectedValue({ code: 'auth/popup-closed-by-user' });
  await login();
  expect(host.textContent).toContain('로그인 창이 닫혔습니다');
  await act(async () => auth.listener?.({ state: 'authorized', uid: 'admin' }));
  expect(host.textContent).toContain('관리자 계정으로 연결되었습니다');
  expect(host.textContent).not.toContain('로그인 창이 닫혔습니다');
});
it('does not report a late popup close as failure after the account signs in', async () => {
  auth.signIn.mockImplementation(async () => {
    auth.listener?.({ state: 'forbidden', uid: 'unregistered' });
    throw { code: 'auth/popup-closed-by-user' };
  });
  await login();
  expect(host.textContent).toContain('이 계정에는 관리자 권한이 없습니다');
  expect(host.textContent).not.toContain('로그인 창이 닫혔습니다');
  expect(auth.list).not.toHaveBeenCalled();
});
