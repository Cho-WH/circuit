// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedbackBoard } from '../src/app/FeedbackBoard';
import { FeedbackAdminPage } from '../src/app/FeedbackAdminPage';
import type { FeedbackAdminGateway, FeedbackGateway, FeedbackPost } from '../src/feedback';

let host: HTMLDivElement;
let root: Root;
const post: FeedbackPost = { id: 'one', nickname: '과학쌤', content: '전위 표현이 수업에 도움이 됐어요.', kind: 'review', visibility: 'public', createdAt: '2026-09-23T00:00:00Z' };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
function gateway(): FeedbackGateway {
  return { list: vi.fn<FeedbackGateway['list']>(async () => ({ ok: true, value: { posts: [post], nextCursor: null } })), create: vi.fn<FeedbackGateway['create']>(async draft => ({ ok: true, value: { ...post, ...draft } })), remove: vi.fn<FeedbackGateway['remove']>(async () => ({ ok: true, value: undefined })) };
}
const button = (label: string) => [...host.querySelectorAll('button')].find(item => item.textContent?.trim() === label)!;
async function click(element: HTMLElement) { await act(async () => element.click()); }
async function fill(selector: string, value: string) {
  await act(async () => {
    const element = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
    const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function render(port: FeedbackGateway) {
  await act(async () => root.render(createElement(FeedbackBoard, { gateway: port, onClose: vi.fn() })));
}
async function compose() {
  await click(button('한마디 남기기'));
  await fill('.feedback-fields input:not([type=password])', '수업하는 쌤');
  await fill('#feedback-content', '좋았어요. 다음에는 학생들과 함께 써볼게요.');
  await fill('.feedback-fields input[type=password]', 'secret-test');
}
async function submit(selector: string) { await act(async () => { host.querySelector(selector)!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); }

describe('DAT-005: feedback board interaction', () => {
  it('starts with readable review bodies, no quota count and no administrator control', async () => {
    await render(gateway());
    expect(host.textContent).toContain(post.content);
    expect(host.textContent).not.toContain('하루 3');
    expect(host.textContent).not.toContain('관리자 미리보기');
    expect(host.querySelector('dialog')!.open).toBe(true);
  });
  it('submits required credentials and routes a private post to the mine view', async () => {
    const port = gateway(); await render(port); await compose();
    await click(host.querySelectorAll<HTMLInputElement>('input[name=feedback-visibility]')[1]);
    await submit('#feedback-compose');
    expect(port.create).toHaveBeenCalledWith(expect.objectContaining({ nickname: '수업하는 쌤', password: 'secret-test', visibility: 'private' }));
    expect(port.list).toHaveBeenLastCalledWith({ scope: 'mine', cursor: undefined });
    expect(host.querySelector('#feedback-compose')).toBeNull();
    expect(host.textContent).toContain('비공개로 남겼어요');
    expect(document.activeElement).toBe(button('한마디 남기기'));
  });
  it('keeps the complete draft after a rejected write and does not reveal remaining quota', async () => {
    const port = gateway(); port.create = vi.fn<FeedbackGateway['create']>(async () => ({ ok: false, code: 'DAILY_LIMIT' }));
    await render(port); await compose(); await submit('#feedback-compose');
    expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toContain('좋았어요');
    expect(host.querySelector<HTMLInputElement>('input[type=password]')!.value).toBe('secret-test');
    expect(host.querySelector('[role=alert]')!.textContent).toContain('내일');
    expect(host.textContent).not.toContain('3개');
  });
  it('keeps a post on a wrong password and removes it only after adapter success', async () => {
    const port = gateway(); port.remove = vi.fn<FeedbackGateway['remove']>(async () => ({ ok: false, code: 'INVALID_PASSWORD' }));
    await render(port); await click(button('글 삭제'));
    await fill('.feedback-delete-form input', 'wrong'); await submit('.feedback-delete-form');
    expect(host.textContent).toContain('비밀번호가 맞지 않아요');
    expect(document.activeElement).toBe(host.querySelector('[role=alert]'));
    expect(host.textContent).toContain(post.content);
    port.remove = vi.fn<FeedbackGateway['remove']>(async () => ({ ok: true, value: undefined }));
    port.list = vi.fn<FeedbackGateway['list']>(async () => ({ ok: true, value: { posts: [], nextCursor: null } }));
    await fill('.feedback-delete-form input', 'correct'); await submit('.feedback-delete-form');
    expect(port.remove).toHaveBeenCalledWith({ id: 'one', password: 'correct' });
    expect(host.textContent).not.toContain(post.content);
    expect(host.textContent).toContain('관리자 보관함에는 기록이 남습니다');
  });
  it('shows retained deleted bodies only through the supplied administrator port', async () => {
    await act(async () => root.render(createElement(FeedbackAdminPage, { gateway: { list: async (): ReturnType<FeedbackAdminGateway['list']> => ({ ok: true, value: [{ ...post, deletedAt: '2026-09-23T01:00:00Z' }, { ...post, id: 'private', content: '비공개 원문', visibility: 'private', deletedAt: null }] }) } })));
    expect(host.querySelector('dialog')).toBeNull();
    expect(host.textContent).toContain('삭제된 글');
    expect(host.textContent).toContain(post.content);
    expect(button('글 삭제')).toBeUndefined();
    await click(button('비공개'));
    expect(host.textContent).toContain('비공개 원문');
    expect(host.textContent).not.toContain(post.content);
    await click(button('삭제된 글'));
    expect(host.textContent).toContain(post.content);
    expect(host.textContent).not.toContain('비공개 원문');
  });
  it('does not load records without an administrator gateway', async () => {
    await act(async () => root.render(createElement(FeedbackAdminPage)));
    expect(host.textContent).toContain('관리자 인증 연결이 필요합니다');
    expect(host.querySelector('article')).toBeNull();
  });
  it('handles administrator access denial without exposing cached records', async () => {
    await act(async () => root.render(createElement(FeedbackAdminPage, { gateway: { list: async (): ReturnType<FeedbackAdminGateway['list']> => ({ ok: false, code: 'FORBIDDEN' }) } })));
    expect(host.textContent).toContain('관리자 권한을 확인할 수 없습니다');
    expect(host.querySelector('article')).toBeNull();
  });
  it('reports unavailable storage and allows retry without claiming an empty board', async () => {
    const port = gateway(); port.list = vi.fn<FeedbackGateway['list']>(async () => ({ ok: false, code: 'UNAVAILABLE' }));
    await render(port);
    expect(host.textContent).toContain('다시 시도');
    expect(host.textContent).not.toContain('첫 이야기를 기다리고');
    port.list = vi.fn<FeedbackGateway['list']>(async () => ({ ok: true, value: { posts: [post], nextCursor: null } }));
    await click(button('다시 시도'));
    expect(host.textContent).toContain(post.content);
  });
});
