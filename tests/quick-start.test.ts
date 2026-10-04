// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { QUICK_START_SEEN_KEY } from '../src/app/useQuickStart';

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  localStorage.setItem(QUICK_START_SEEN_KEY, 'true');
  vi.spyOn(Element.prototype, 'animate').mockImplementation(() => ({
    finished: Promise.resolve(), cancel: vi.fn(),
  }) as unknown as Animation);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});
const button = (label: string) =>
  [...host.querySelectorAll('button')].find(
    (element) =>
      element.getAttribute('aria-label') === label || element.textContent?.trim() === label,
  )!;

it('automatically opens on the first visit, remembers dismissal and can still be reopened', async () => {
  localStorage.removeItem(QUICK_START_SEEN_KEY);
  await act(async () => root.render(createElement(App)));
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  expect(localStorage.getItem(QUICK_START_SEEN_KEY)).toBeNull();
  await act(async () => button('직접 해보기').click());
  expect(localStorage.getItem(QUICK_START_SEEN_KEY)).toBe('true');
  expect(document.activeElement).toBe(button('사용 도움말'));
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(createElement(App)));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => button('사용 도움말').click());
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
});

it('allows dismissal and manual reopening when browser storage is unavailable', async () => {
  vi.stubGlobal('localStorage', {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  });
  await act(async () => root.render(createElement(App)));
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => button('도움말 닫기').click());
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => button('사용 도움말').click());
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
});

it('finishes the first close at the help button once, then restores focus and releases its animations', async () => {
  localStorage.removeItem(QUICK_START_SEEN_KEY);
  await act(async () => root.render(createElement(App)));
  const surface = host.querySelector<HTMLElement>('.quick-start-dialog')!;
  const backdrop = host.querySelector<HTMLElement>('.quick-start-backdrop')!;
  const target = button('사용 도움말');
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 60, 350, 680));
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(342, 8, 36, 36));
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  const animations: { cancel: ReturnType<typeof vi.fn> }[] = [];
  for (const element of [surface, backdrop, target, ...surface.children]) {
    element.animate = vi.fn(() => {
      const animation = { finished, cancel: vi.fn() };
      animations.push(animation);
      return animation as unknown as Animation;
    });
  }
  await act(async () => button('직접 해보기').click());
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(surface.animate).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[role="dialog"]')).toBe(surface);
  expect(localStorage.getItem(QUICK_START_SEEN_KEY)).toBeNull();
  const frames = vi.mocked(surface.animate).mock.calls[0][0] as Keyframe[];
  expect(frames.at(-1)!.transform).toContain('translate(165px, -374px)');
  await act(async () => finish());
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(localStorage.getItem(QUICK_START_SEEN_KEY)).toBe('true');
  expect(document.activeElement).toBe(target);
  expect(target.animate).toHaveBeenCalledTimes(1);
  expect(animations.slice(0, -1).every(animation => animation.cancel.mock.calls.length === 1)).toBe(true);
});

it('contains keyboard focus and restores the help trigger without changing the circuit or active mode', async () => {
  await act(async () => root.render(createElement(App)));
  await act(async () => button('분석하기').click());
  const canvas = host.querySelector('.circuit-canvas')!;
  const before = canvas.outerHTML;
  const trigger = button('사용 도움말');
  trigger.focus();
  await act(async () => trigger.click());
  const dialog = host.querySelector('[role="dialog"]')!;
  expect(
    document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent,
  ).toBeTruthy();
  expect(document.activeElement).toBe(button('도움말 닫기'));
  await act(async () =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    ),
  );
  expect(document.activeElement).toBe(button('직접 해보기'));
  await act(async () =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    ),
  );
  expect(document.activeElement).toBe(button('도움말 닫기'));
  await act(async () =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    ),
  );
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(button('분석하기').getAttribute('aria-pressed')).toBe('true');
  expect(canvas.outerHTML).toBe(before);
});

it.each(['도움말 닫기', '직접 해보기', 'backdrop'])(
  'closes via %s and can reopen without resetting the view',
  async (action) => {
    await act(async () => root.render(createElement(App)));
    await act(async () => button('확대').click());
    const before = host.querySelector('.circuit-canvas')!.getAttribute('viewBox');
    await act(async () => button('사용 도움말').click());
    await act(async () => host.querySelector<HTMLElement>('.quick-start-body')!.click());
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => {
      if (action === 'backdrop') host.querySelector<HTMLElement>('.quick-start-backdrop')!.click();
      else button(action).click();
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('.circuit-canvas')!.getAttribute('viewBox')).toBe(before);
    await act(async () => button('사용 도움말').click());
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  },
);

it('blocks editing shortcuts behind the guide while a component is selected', async () => {
  await act(async () => root.render(createElement(App)));
  await act(async () =>
    host
      .querySelector('.component')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
  );
  const canvas = host.querySelector('.circuit-canvas')!;
  const before = canvas.outerHTML;
  await act(async () => button('사용 도움말').click());
  for (const key of ['Delete', 'r', 'w', 'ArrowRight', 'z']) {
    await act(async () =>
      button('도움말 닫기').dispatchEvent(
        new KeyboardEvent('keydown', {
          key,
          ctrlKey: key === 'z',
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
  }
  expect(canvas.outerHTML).toBe(before);
  expect(button('선택').getAttribute('aria-pressed')).toBe('true');
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
});
