// @vitest-environment happy-dom
import { act, createElement, createRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  OperatingHelp,
  OperatingHelpOverlay,
  type OperatingHelpItem,
  type OperatingHelpOverlayHandle,
} from '../src/app/operating-help';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const item = (id: string): OperatingHelpItem => ({
  componentId: id,
  key: id,
  label: id,
  automatic: true,
  questions: [{ topic: 'source-terminal-drop' }, { topic: 'source-not-broken' }],
});

it('does not propagate help gestures to the circuit, supports keyboard dismissal and reopens the first question', () => {
  const pointer = vi.fn(),
    key = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(false);
    return createElement(
      'div',
      { onPointerDown: pointer, onKeyDown: key },
      createElement(OperatingHelp, { item: item('V1'), open, onOpenChange: setOpen }),
    );
  }
  act(() => root.render(createElement(Harness)));
  const trigger = host.querySelector('button')!;
  act(() => {
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    trigger.click();
  });
  expect(pointer).not.toHaveBeenCalled();
  const related = document.querySelector<HTMLButtonElement>('.operating-help-related button')!;
  act(() => related.click());
  expect(document.activeElement?.textContent).toBe('전지가 망가진 건가요?');
  act(() =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(key).not.toHaveBeenCalled();
  act(() => trigger.click());
  expect(document.querySelector('h3')?.textContent).toBe('전지 전압이 왜 낮아졌나요?');
});

it('limits automatic markers to three and removes hidden targets from keyboard navigation', () => {
  const ref = createRef<OperatingHelpOverlayHandle>(),
    visible = vi.fn();
  act(() =>
    root.render(
      createElement(OperatingHelpOverlay, {
        ref,
        items: ['a', 'b', 'c', 'd'].map(item),
        openKey: null,
        onOpen: vi.fn(),
        onVisible: visible,
      }),
    ),
  );
  expect(host.querySelectorAll('[data-help-component]')).toHaveLength(3);
  const layout = {
    bounds: { x: 0, y: 0, width: 800, height: 400 },
    labels: ['a', 'b', 'c', 'd'].map((id, i) => ({
      componentId: id,
      x: 100 + i * 170,
      y: 100,
      width: 30,
      height: 20,
    })),
    obstacles: [],
  };
  act(() => ref.current!.updateLayout(layout));
  expect(visible).toHaveBeenLastCalledWith(['a', 'b', 'c']);
  expect(host.querySelectorAll('[data-help-component]:not([hidden])')).toHaveLength(3);
  act(() => ref.current!.updateLayout({ ...layout, obstacles: [layout.bounds] }));
  expect(visible).toHaveBeenLastCalledWith([]);
  expect(host.querySelectorAll('[data-help-component]:not([hidden])')).toHaveLength(0);
});
