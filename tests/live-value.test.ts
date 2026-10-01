import * as q from '../src/rational';
// @vitest-environment happy-dom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createComponent, adjustableParameter } from '../src/component-library';
import { ParameterControl } from '../src/app/parameters';
import { useLiveValue } from '../src/app/parameters/useLiveValue';

let root: Root, host: HTMLDivElement, live: ReturnType<typeof useLiveValue>;
let frames: Map<number, FrameRequestCallback>,
  id = 0;
const apply = vi.fn((_value: number, _group?: object) => true);
function Harness({ value = 10 }: { value?: number }) {
  live = useLiveValue(value, 1, 100, apply);
  return null;
}
const step = (now: number) =>
  act(() => {
    const [key, callback] = [...frames][0];
    frames.delete(key);
    callback(now);
  });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  frames = new Map();
  apply.mockReset();
  apply.mockReturnValue(true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
  host = document.createElement('div');
  root = createRoot(host);
  act(() => root.render(createElement(Harness)));
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

it('coalesces input, flushes the last value and gives each gesture its own undo token', () => {
  act(() => {
    live.change(20);
    live.change(30);
    live.change(40);
  });
  expect(apply).not.toHaveBeenCalled();
  expect(live.displayed).toBe(40);
  expect(live.adjusting).toBe(true);
  step(100);
  expect(apply).toHaveBeenCalledTimes(1);
  expect(apply.mock.calls[0][0]).toBe(40);
  const token = apply.mock.calls[0][1];
  act(() => {
    live.change(50);
    live.finish();
  });
  expect(apply.mock.calls[1]).toEqual([50, token]);
  expect(frames.size).toBe(0);
  expect(live.adjusting).toBe(false);
  act(() => {
    live.change(60);
    live.finish();
  });
  expect(apply.mock.calls[2][1]).not.toBe(token);
});
it('stops automatic movement on direct input, external changes, and disposal', () => {
  act(() => live.start());
  step(100);
  step(200);
  expect(live.running).toBe(true);
  expect(apply.mock.calls.at(-1)![0]).toBeGreaterThan(10);
  act(() => {
    live.change(25);
    live.finish();
  });
  expect(live.running).toBe(false);
  expect(apply.mock.calls.at(-1)![0]).toBe(25);
  act(() => live.start());
  act(() => root.render(createElement(Harness, { value: 8 })));
  expect(live.running).toBe(false);
  expect(frames.size).toBe(0);
  expect(live.displayed).toBe(8);
  act(() => live.start());
  act(() => root.render(null));
  expect(frames.size).toBe(0);
});
it('stops and restores the displayed value when the command is denied', () => {
  apply.mockReturnValue(false);
  act(() => {
    live.change(20);
    live.finish();
  });
  expect(live.displayed).toBe(10);
  expect(live.failed).toBe(true);
  expect(frames.size).toBe(0);
});

it('publishes automatic values in the same frame without treating its own prior result as an external edit', () => {
  function IntegratedHarness() {
    const [value, setValue] = useState(10);
    live = useLiveValue(value, 1, 100, (next) => {
      setValue(next);
      return true;
    });
    return createElement('output', null, value);
  }
  act(() => root.render(createElement(IntegratedHarness)));
  act(() => live.start());
  step(100);
  for (let now = 200; now <= 1200; now += 100)
    act(() => {
      const [key, callback] = [...frames][0];
      frames.delete(key);
      callback(now);
      expect(Number(host.querySelector('output')!.textContent)).toBe(live.displayed);
      expect(live.running).toBe(true);
    });
});


it.each([100, 5000])('finishes a slider commit arriving after release without requiring blur (hold=%sms)', hold => {
  const activity = vi.fn();
  function ControlHarness() {
    const [component, setComponent] = useState(() => {
      const c = createComponent('resistive-load', 'VR1', { x: 0, y: 0 });
      c.properties = { resistanceOhm: q.store(3), resistanceMinOhm: q.store(1), resistanceMaxOhm: q.store(6) };
      return c;
    });
    return createElement(ParameterControl, {
      component, parameter: adjustableParameter(component)!, disabled: false,
      onAdjustingChange: activity,
      onChange: value => { setComponent(c => ({ ...c, properties: { ...c.properties, resistanceOhm: value } })); return true; },
    });
  }
  act(() => root.render(createElement(ControlHarness)));
  const slider = host.querySelector<HTMLInputElement>('[type="range"]')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setValue.call(slider, '696');
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  step(hold);
  expect(activity).toHaveBeenLastCalledWith('VR1', true);
  act(() => slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })));
  expect(activity).toHaveBeenLastCalledWith('VR1', false);
  act(() => {
    // Chromium normalizes the controlled 696.0000000000001 value back to 696 at commit.
    setValue.call(slider, '696');
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(slider.getAttribute('aria-valuenow')).toBe('4.48');
  expect(activity).toHaveBeenLastCalledWith('VR1', false);
  expect(frames.size).toBe(0);
});

it('offers direct play/pause and resumes from the paused value in the same direction', () => {
  const activity = vi.fn();
  function ControlHarness() {
    const [component, setComponent] = useState(() => {
      const c = createComponent('resistive-load', 'VR1', { x: 0, y: 0 });
      c.properties.resistanceOhm = q.store(100);
      return c;
    });
    return createElement(ParameterControl, {
      component, parameter: adjustableParameter(component)!, disabled: false,
      onAdjustingChange: activity,
      onChange: (value: q.StoredScalar) => {
        setComponent(c => ({ ...c, properties: { ...c.properties, resistanceOhm: value } }));
        return true;
      },
    });
  }
  act(() => root.render(createElement(ControlHarness)));
  const button = () => host.querySelector<HTMLButtonElement>('button')!;
  const value = () => Number(host.querySelector('[type="range"]')!.getAttribute('aria-valuenow'));
  expect(host.querySelector('details, input[type="checkbox"]')).toBeNull();
  expect(button().textContent).toBe('저항 자동 조절');
  act(() => button().click());
  expect(button().textContent).toBe('일시 정지');
  expect(activity).toHaveBeenLastCalledWith('VR1', true);
  step(100); step(200);
  const pausedValue = value();
  expect(pausedValue).toBeLessThan(100);
  act(() => button().click());
  expect(frames.size).toBe(0);
  expect(value()).toBe(pausedValue);
  expect(button().textContent).toBe('저항 자동 조절');
  expect(activity).toHaveBeenLastCalledWith('VR1', false);
  act(() => button().click());
  step(300); step(400);
  expect(value()).toBeLessThan(pausedValue);
  act(() => root.render(null));
  expect(activity).toHaveBeenLastCalledWith('VR1', false);
});
