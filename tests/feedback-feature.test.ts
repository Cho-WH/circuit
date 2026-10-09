// @vitest-environment happy-dom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FeedbackFeature } from '../src/app/FeedbackFeature';
import {
  FeedbackInitializationError,
  feedbackFailure,
  feedbackFailureReport,
} from '../src/app/feedback-failure';
import { App } from '../src/app/App';
import { ErrorBoundary } from '../src/app/ErrorBoundary';
import { QUICK_START_SEEN_KEY } from '../src/app/useQuickStart';
import { releaseChannel } from '../src/release';

vi.mock('../src/app/FeedbackBoard', () => ({
  default: () => {
    throw new Error('board render failure');
  },
}));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  localStorage.setItem(QUICK_START_SEEN_KEY, 'true');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host, { onCaughtError: vi.fn() });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const button = (name: string) =>
  [...host.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label') === name || b.textContent?.trim() === name,
  )!;
const click = (name: string) => act(async () => button(name).click());
const report = () =>
  JSON.parse(host.querySelector<HTMLTextAreaElement>('[aria-label="한마디 오류 정보"]')!.value);
type Loader = NonNullable<Parameters<typeof FeedbackFeature>[0]['load']>;
const loaded: Awaited<ReturnType<Loader>> = {
  default: () => createElement('div', { 'data-board': true }, 'loaded'),
};
const render = (load: Loader, onClose = vi.fn()) =>
  act(async () => root.render(createElement(FeedbackFeature, { load, onClose })));

it('starts a fresh load on retry after a rejected import', async () => {
  const load = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('download failed'))
    .mockResolvedValueOnce(loaded);
  await render(load);
  expect(report()).toMatchObject({ stage: 'load', errorType: 'TypeError' });
  await click('다시 시도');
  expect(load).toHaveBeenCalledTimes(2);
  expect(host.querySelector('[data-board]')).not.toBeNull();
  expect(host.querySelector('[role=alert]')).toBeNull();
});

it.each(['initialize', 'render'] as const)(
  'contains %s failures and retries with a new board instance',
  async (stage) => {
    let fails = true;
    const load = vi.fn(async () => ({
      default: () => {
        if (fails)
          throw stage === 'initialize'
            ? new FeedbackInitializationError(new TypeError('setup'))
            : new RangeError('render');
        return createElement('div', { 'data-board': true });
      },
    }));
    await render(load);
    expect(report().stage).toBe(stage);
    fails = false;
    await click('다시 시도');
    expect(host.querySelector('[data-board]')).not.toBeNull();
  },
);

it('times out a stalled load, permits retry, and ignores its late resolution', async () => {
  vi.useFakeTimers();
  let finish!: (value: typeof loaded) => void;
  const load = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(loaded);
  await render(load);
  await act(async () => vi.advanceTimersByTime(15000));
  expect(report().code).toBe('LOAD_TIMEOUT');
  await click('다시 시도');
  const board = host.querySelector('[data-board]');
  await act(async () => finish({ default: () => createElement('div', { 'data-stale': true }) }));
  expect(host.querySelector('[data-board]')).toBe(board);
  expect(host.querySelector('[data-stale]')).toBeNull();
});

it('cancels loading with Escape and ignores completion after closing', async () => {
  let finish!: (value: typeof loaded) => void;
  const load = () =>
    new Promise<typeof loaded>((resolve) => {
      finish = resolve;
    });
  function Harness() {
    const [open, setOpen] = useState(false);
    return createElement(
      'div',
      null,
      createElement('button', { onClick: () => setOpen(true) }, 'open'),
      open && createElement(FeedbackFeature, { load, onClose: () => setOpen(false) }),
    );
  }
  await act(async () => root.render(createElement(Harness)));
  button('open').focus();
  await click('open');
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  await act(async () => finish(loaded));
  expect(host.querySelector('[role=dialog]')).toBeNull();
  expect(host.querySelector('[data-board]')).toBeNull();
  expect(document.activeElement).toBe(button('open'));
});

it('copies only diagnostic metadata and offers selectable text if clipboard is denied', async () => {
  await render(async () => {
    throw new Error('private circuit title and draft https://example.test/?token=secret');
  });
  await act(async () => host.querySelector('summary')!.click());
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
  await click('오류 정보 복사');
  expect(copy).toHaveBeenCalledTimes(1);
  const metadata = JSON.parse(copy.mock.calls[0][0]);
  expect(metadata).toMatchObject({
    feature: 'feedback',
    version: '0.1.0',
    channel: releaseChannel(),
    stage: 'load',
  });
  expect(copy.mock.calls[0][0]).not.toMatch(/private|secret|example\.test|draft/);
  copy.mockRejectedValue(new Error('denied'));
  await click('오류 정보 복사');
  expect(host.querySelector('[role=status]')?.textContent).toContain('선택해 복사');
  expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(copy.mock.calls[0][0]);
  expect(
    feedbackFailureReport(feedbackFailure('list', { code: 'private text', name: 'private name' })),
  ).not.toContain('private');
});

it('keeps the real circuit canvas, unsaved document and Undo history through board failure', async () => {
  vi.useFakeTimers();
  await act(async () =>
    root.render(createElement(ErrorBoundary, { children: createElement(App) })),
  );
  const title = host.querySelector<HTMLInputElement>('[aria-label="회로 제목"]')!;
  const original = title.value;
  await act(async () => {
    title.value = '유지할 회로';
    title.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
  expect(button('실행 취소').disabled).toBe(false);
  const canvas = host.querySelector('.circuit-canvas');
  button('사용 후기 및 피드백').focus();
  await click('사용 후기 및 피드백');
  expect(report().stage).toBe('render');
  expect(host.textContent).not.toContain('화면을 표시하지 못했습니다.');
  expect(host.querySelector('.circuit-canvas')).toBe(canvas);
  expect(host.querySelector<HTMLInputElement>('[aria-label="회로 제목"]')!.value).toBe(
    '유지할 회로',
  );
  await click('닫기');
  expect(document.activeElement).toBe(button('사용 후기 및 피드백'));
  await click('실행 취소');
  expect(host.querySelector<HTMLInputElement>('[aria-label="회로 제목"]')!.value).toBe(original);
});
