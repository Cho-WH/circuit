// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});
const button = (label: string) =>
  [...host.querySelectorAll('button')].find(
    (element) =>
      element.getAttribute('aria-label') === label || element.textContent?.trim() === label,
  )!;

it('contains keyboard focus and restores the help trigger without changing the circuit or active mode', async () => {
  await act(async () => root.render(createElement(App)));
  await act(async () => button('전위 보기').click());
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
  expect(button('전위 보기').getAttribute('aria-pressed')).toBe('true');
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
