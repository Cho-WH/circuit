import * as q from '../src/rational';
// @vitest-environment happy-dom
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { examples } from '../src/fixtures';
import { layoutExample } from '../src/app/examples';
import { saveLocal, loadLocal, loadMeasurementNotebook } from '../src/persistence';
import type { Potential3DProps } from '../src/potential-3d';

const observed = vi.hoisted(() => ({ document: null as Potential3DProps['document'] | null, current: undefined as Potential3DProps['currentDisplay'], measurement: undefined as Potential3DProps['voltageMeasurement'], selections: [] as string[][], onSelect: undefined as Potential3DProps['onSelect'], onSelectNet: undefined as Potential3DProps['onSelectNet'], selectedNet: null as Potential3DProps['selectedNet'] }));
vi.mock('../src/potential-3d', () => ({
  Potential3D: (props: Potential3DProps) => {
    observed.document = props.document;
    observed.current = props.currentDisplay;
    observed.onSelect = props.onSelect;
    observed.onSelectNet = props.onSelectNet;
    observed.selectedNet = props.selectedNet;
    observed.measurement = props.voltageMeasurement;
    observed.selections.push(props.selectedIds);
    useEffect(() => {
      props.onReady?.();
      props.onEntered?.();
    }, []);
    return createElement('div', { 'data-test-scene': true }, '3D');
  },
}));
let host: HTMLDivElement, root: Root;
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
const button = (name: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) =>
      b.getAttribute('aria-label') === name ||
      b.textContent?.trim() === name ||
      b.querySelector(':scope > span:last-child')?.textContent === name,
  )!;
const click = (name: string) => act(async () => button(name).click());
const toggle = (name: string) =>
  [...host.querySelectorAll<HTMLInputElement>('.potential-controls input')].find(
    (input) => input.parentElement?.textContent?.trim() === name,
  )!;
const enter = (selector: string) =>
  act(async () =>
    host
      .querySelector(selector)!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
  );
const value = () => host.querySelector('output[aria-label="측정값"]')?.textContent;
async function mount() {
  const doc = layoutExample(examples.find((e) => e.id === 'FIX-02')!.document);
  saveLocal(doc);
  await act(async () => root.render(createElement(App)));
  await click('분석하기');
  return doc;
}
async function probeResistor() {
  await enter('[data-endpoint-id="R1.a"]');
  await enter('[data-endpoint-id="R1.b"]');
}

it('adjusts resistance beside the probes and records exact conditions without restarting 3D', async () => {
  const doc = layoutExample(examples.find(e => e.id === 'FIX-02')!.document);
  const variable = doc.components.find(c => c.id === 'R1')!;
  variable.type = 'resistive-load'; variable.properties = { resistanceOhm: q.store(3), resistanceMinOhm: q.store(3), resistanceMaxOhm: q.store(6) };
  doc.components.find(c => c.id === 'R2')!.properties.resistanceOhm = q.store(3);
  saveLocal(doc);
  await act(async () => root.render(createElement(App)));
  await click('분석하기');
  expect(host.querySelector('.parameter-panel:not([hidden])')).toBeNull();
  await click('전압 탐침'); await probeResistor();
  await enter('[data-component-id="R1"] .component');
  await click('3D');
  const scene = host.querySelector('[data-test-scene]');
  expect(value()).toBe('4.5 V'); await click('측정값 기록');
  const input = host.querySelector<HTMLInputElement>('.parameter-control input:not([type])')!;
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '6');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(value()).toBe('4.5 V');
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(value()).toBe('6 V');
  expect(observed.measurement?.label).toBe(value());
  expect(host.querySelector('[data-test-scene]')).toBe(scene);
  expect(host.querySelector('.potential-workspace')!.getAttribute('data-status')).toBe('ready');
  expect(observed.measurement?.red?.endpointId).toBe('R1.a');
  await click('측정값 기록');
  const records = loadMeasurementNotebook().entries;
  expect(records.map(e => e.record.value === null ? null : q.toNumber(e.record.value))).toEqual([4.5, 6]);
  expect(records.map(e => q.toNumber(e.record.documentSnapshot.components.find(c => c.id === 'R1')!.properties.resistanceOhm as q.Scalar))).toEqual([3, 6]);
});

it('shows only the selected adjustable component and clears it in both views without moving probes', async () => {
  const doc = layoutExample(examples.find(e => e.id === 'FIX-02')!.document);
  for (const id of ['R1', 'R2']) {
    const c = doc.components.find(c => c.id === id)!;
    c.type = 'resistive-load';
    c.properties = { resistanceOhm: q.store(id === 'R1' ? 3 : 6), resistanceMinOhm: q.store(1), resistanceMaxOhm: q.store(10) };
  }
  saveLocal(doc);
  await act(async () => root.render(createElement(App)));
  await click('분석하기');
  expect(host.querySelector('.parameter-panel:not([hidden])')).toBeNull();
  await click('전압 탐침'); await probeResistor();
  for (const id of ['R1', 'R2']) {
    await enter(`[data-component-id="${id}"] .component`);
    expect(host.querySelector('.parameter-panel:not([hidden]) .parameter-control input:not([type])')?.id).toBe(`parameter-${id}`);
    expect(host.querySelector('.parameter-panel select')).toBeNull();
    expect(value()).toBe('3 V');
  }
  await click('3D');
  await act(async () => observed.onSelect!(null));
  expect(host.querySelector('.parameter-panel:not([hidden])')).toBeNull();
  await act(async () => observed.onSelect!('R1'));
  expect(host.querySelector('.parameter-panel:not([hidden]) .parameter-control input:not([type])')?.id).toBe('parameter-R1');
  expect(observed.measurement?.red?.endpointId).toBe('R1.a');
  expect(observed.measurement?.black?.endpointId).toBe('R1.b');
  await act(async () => observed.onSelect!('V1'));
  expect(host.querySelector('.parameter-panel:not([hidden])')).toBeNull();
  await click('2D');
  await enter('[data-component-id="R2"] .component');
  await enter('[data-component-id="V1"] .component');
  expect(host.querySelector('.parameter-panel:not([hidden])')).toBeNull();
  expect(value()).toBe('3 V');

  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback); return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  await enter('[data-component-id="R2"] .component');
  const control = host.querySelector('.parameter-panel:not([hidden])')!;
  await act(async () => control.querySelector<HTMLButtonElement>('[aria-label="저항 자동 조절"]')!.click());
  await enter('[data-component-id="V1"] .component');
  expect(control.hasAttribute('hidden')).toBe(true);
  for (const now of [100, 200]) await act(async () => {
    const callbacks = [...frames.values()]; frames.clear();
    callbacks.forEach(callback => callback(now));
  });
  expect(Number(control.querySelector('.parameter-slider')?.getAttribute('aria-valuenow'))).toBeGreaterThan(6);
  expect(value()).not.toBe('3 V');
  await enter('[data-component-id="R2"] .component');
  expect(host.querySelector('.parameter-panel:not([hidden])')).toBe(control);
  expect(control.querySelector('[aria-label="저항 자동 조절 일시 정지"]')).not.toBeNull();
  await act(async () => toggle('전류 흐름').click());
  await click('3D');
  expect(observed.current?.changing).toBe(true);
  await act(async () => observed.onSelect!(null));
  expect(observed.current?.changing).toBe(true);
  // A second sweep must not release suppression while the first one is still running.
  await act(async () => observed.onSelect!('R1'));
  const otherControl = host.querySelector('.parameter-panel:not([hidden])')!;
  await act(async () => otherControl.querySelector<HTMLButtonElement>('button')!.click());
  await act(async () => control.querySelector<HTMLButtonElement>('button')!.click());
  expect(observed.current?.changing).toBe(true);
  await act(async () => otherControl.querySelector<HTMLButtonElement>('button')!.click());
  expect(observed.current?.changing).toBe(false);
  await act(async () => control.querySelector<HTMLButtonElement>('button')!.click());
  await click('회로 만들기');
  expect(frames.size).toBe(0);
});

it('preserves hidden answers, probe positions, records and viewport while updating component values', async () => {
  await mount();
  expect(host.querySelectorAll('.analysis-tools button')).toHaveLength(3);
  await act(async () => {
    toggle('색상').click();
    toggle('숫자').click();
  });
  await click('확대');
  const canvas = host.querySelector('.circuit-canvas')!;
  const view = canvas.getAttribute('viewBox');
  await click('전압 탐침');
  await probeResistor();
  expect(value()).toBe('3 V');
  expect(toggle('색상').checked).toBe(false);
  expect(toggle('숫자').checked).toBe(false);
  expect(host.querySelector('[data-endpoint-id="R1.a"] title')?.textContent).toBe('');
  await click('측정값 기록');
  expect(host.querySelector<HTMLElement>('#measurement-notebook')?.hidden).toBe(true);
  expect(canvas.getAttribute('viewBox')).toBe(view);
  expect(host.querySelector('.record-scroll tbody')?.textContent).toContain('3 V');
  await click('기록 보기 1');
  await click('경로 그래프');
  expect(host.querySelector('.record-scroll')?.closest<HTMLElement>('[hidden]')).not.toBeNull();
  await click('경로 그래프');
  await click('상세 설정');
  const select = host.querySelector<HTMLSelectElement>('[aria-label="값을 바꿀 부품"]')!;
  await act(async () => {
    select.value = 'R1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const input = host.querySelector<HTMLInputElement>(`[aria-label="R_1 값"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '6');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () =>
    input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(value()).toBe('4.5 V');
  await act(async () =>
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  expect(host.querySelector('.measurement-surface')).toBeNull();
  await click('전류 센서');
  await enter('[data-component-id="R1"] .component');
  expect(value()).toBe('750 mA');
  await click('도구 종료');
  expect(host.querySelector('.measurement-surface')).toBeNull();
  expect(host.querySelector('output[aria-label="측정값"]')).toBeNull();
  await click('기록 보기 1');
  expect(host.querySelector('.record-scroll tbody')?.textContent).toContain('3 V');
  await click('기록 보기 1');
  await click('전압 탐침');
  expect(value()).toBe('4.5 V');
  expect(host.querySelector('.circuit-canvas')).toBe(canvas);
  expect(canvas.getAttribute('viewBox')).toBe(view);
  await click('회로 만들기');
  await click('분석하기');
  await click('기록 보기 1');
  expect(host.querySelector('.record-scroll tbody')?.textContent).toContain('3 V');
  const liveCanvas = host.querySelector('.circuit-canvas');
  await act(async () => host.querySelector<HTMLButtonElement>('.record-location')!.click());
  const historical = document.querySelector('[aria-label="기록 당시 회로"]')!;
  expect(
    historical.querySelector('[data-component-id="R1"] .component')?.getAttribute('aria-label'),
  ).toContain('3 Ω');
  expect(historical.textContent).toContain('3 V');
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="기록 회로 닫기"]')!.click(),
  );
  expect(host.querySelector('.circuit-canvas')).toBe(liveCanvas);
  await click('전압 탐침');
  expect(value()).toBe('4.5 V');
});

it('requires source detachment, suppresses operating results, and restores the previous view without editing the document', async () => {
  const doc = await mount();
  await click('전압 탐침');
  await probeResistor();
  await act(async () => toggle('전류 흐름').click());
  await click('등가저항');
  expect(host.querySelector('[data-source-isolated]')).toBeNull();
  expect(host.querySelector('.measurement-surface')).toBeNull();
  expect(button('측정값 기록')).toBeUndefined();
  await click('전지 분리하고 측정');
  expect(value()).toBe('3 Ω');
  expect(host.querySelectorAll('[data-source-isolated]')).toHaveLength(1);
  expect(toggle('색상').checked).toBe(false);
  expect(toggle('숫자').checked).toBe(false);
  expect(toggle('전류 흐름').checked).toBe(false);
  expect(host.querySelector('.current-flow-overlay')).toBeNull();
  expect(button('경로 그래프').disabled).toBe(true);
  await click('측정값 기록');
  expect(host.querySelector('.record-scroll tbody')?.textContent).toContain('모든 전원 분리');
  await click('도구 종료');
  expect(toggle('색상').checked).toBe(true);
  expect(toggle('숫자').checked).toBe(true);
  expect(toggle('전류 흐름').checked).toBe(true);
  expect(host.querySelector('[data-source-isolated]')).toBeNull();
  await click('3D');
  expect(host.querySelector('.potential-workspace')?.getAttribute('data-status')).toBe('ready');
  expect(host.querySelector('.measurement-surface')).toBeNull();
  expect(host.querySelector('.measure-console')).toBeNull();
  await click('등가저항');
  await click('전지 분리하고 측정');
  expect(host.querySelector('[data-test-scene]')).toBeNull();
  await click('도구 종료');
  expect(button('3D').getAttribute('aria-pressed')).toBe('true');
  await click('전압 탐침');
  expect(button('2D').getAttribute('aria-pressed')).toBe('true');
  expect(value()).toBe('3 V');
  expect(observed.document).toEqual(doc);
  expect(loadLocal()).toMatchObject({ ok: true, document: doc });
});

it('starts resistance measurement immediately on a source-free circuit', async () => {
  const doc = layoutExample(examples.find((e) => e.id === 'FIX-02')!.document);
  doc.components = doc.components.filter((c) => c.type !== 'dc-voltage-source');
  doc.wires = doc.wires.filter((w) => !w.start.id.startsWith('V1.') && !w.end.id.startsWith('V1.'));
  doc.referenceNode = null;
  saveLocal(doc);
  await act(async () => root.render(createElement(App)));
  await click('분석하기');
  await click('등가저항');
  expect(button('전지 분리하고 측정')).toBeUndefined();
  await probeResistor();
  expect(value()).toBe('3 Ω');
});


it('keeps voltage probes, polarity, display preferences and recording across 2D/3D', async () => {
  const doc = await mount();
  await click('전압 탐침');
  await probeResistor();
  await act(async () => { toggle('숫자').click(); toggle('색상').click(); });
  const view = host.querySelector('.circuit-canvas')!.getAttribute('viewBox');
  observed.selections = [];
  await click('3D');
  // Ready/status updates must not rebuild the scene and interrupt its entry animation.
  expect(new Set(observed.selections).size).toBe(1);
  expect(observed.measurement?.label).toBe('3 V');
  expect(observed.measurement?.red?.endpointId).toBe('R1.a');
  expect(value()).toBe('3 V');
  expect(host.querySelector<HTMLElement>('.measure-console')?.hidden).toBe(false);
  expect(button('빨강 탐침')).toBeDefined();
  expect(button('검정 탐침')).toBeDefined();
  expect(button('측정 위치 지우기')).toBeDefined();
  expect(button('2D에서 위치 변경')).toBeUndefined();
  expect(toggle('색상').checked).toBe(false);
  expect(toggle('숫자').checked).toBe(false);
  await click('두 탐침 맞바꾸기');
  expect(observed.measurement?.label).toBe('-3 V');
  expect(observed.measurement?.red?.endpointId).toBe('R1.b');
  await click('측정값 기록');
  expect(loadMeasurementNotebook().entries[0].record.value).toEqual(q.store(-3));
  await click('빨강 탐침');
  expect(button('2D').getAttribute('aria-pressed')).toBe('true');
  expect(button('빨강 탐침').getAttribute('aria-pressed')).toBe('true');
  expect(value()).toBe('-3 V');
  expect(host.querySelector('.circuit-canvas')!.getAttribute('viewBox')).toBe(view);
  expect(host.querySelector('[data-measurement-handle="red"]')).not.toBeNull();
  await click('3D');
  await click('검정 탐침');
  expect(button('2D').getAttribute('aria-pressed')).toBe('true');
  expect(button('검정 탐침').getAttribute('aria-pressed')).toBe('true');
  await click('3D');
  await click('전압 탐침');
  expect(button('2D').getAttribute('aria-pressed')).toBe('true');
  expect(button('전압 탐침').getAttribute('aria-pressed')).toBe('true');
  expect(value()).toBe('-3 V');
  await click('3D');
  await click('측정 위치 지우기');
  expect(observed.measurement).toEqual({red:null,black:null,label:null});
  expect(button('측정값 기록').disabled).toBe(true);
  await click('도구 종료');
  expect(observed.measurement).toBeUndefined();
  expect(button('3D').getAttribute('aria-pressed')).toBe('true');
  expect(loadLocal()).toMatchObject({ok:true,document:doc});
});


it('shares selection and clearing between 2D and 3D, including wire net highlights', async () => {
  const doc = await mount();
  await enter('[data-component-id="R1"] .component');
  await click('3D');
  expect(observed.selections.at(-1)).toEqual(['R1']);
  await act(async () => observed.onSelect!(doc.wires[0].id));
  expect(observed.selectedNet).toBeTruthy();
  await act(async () => observed.onSelect!(null));
  expect(observed.selections.at(-1)).toEqual([]);
  expect(observed.selectedNet).toBeNull();
  await act(async () => observed.onSelect!('R1'));
  await click('2D');
  const canvas = host.querySelector('.circuit-canvas')!;
  await act(async () => canvas.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, button: 0, pointerId: 1, pointerType: 'touch',
  })));
  await act(async () => {
    canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1, pointerType: 'touch' }));
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await click('3D');
  expect(observed.selections.at(-1)).toEqual([]);
});

it('inspector selection clears a prior wire net', async () => {
  const doc = await mount();
  await click('3D');
  await act(async () => observed.onSelect!(doc.wires[0].id));
  await click('상세 설정');
  const select = host.querySelector<HTMLSelectElement>('[aria-label="값을 바꿀 부품"]')!;
  await act(async () => {
    select.value = 'R1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(observed.selections.at(-1)).toEqual(['R1']);
  expect(observed.selectedNet).toBeNull();
});
it('selecting a different component in build clears the old analysis net', async () => {
  const doc = await mount();
  await click('3D');
  await act(async () => observed.onSelect!(doc.wires[0].id));
  await click('회로 만들기');
  await enter('[data-component-id="R1"] .component');
  await click('분석하기');
  expect(observed.selections.at(-1)).toEqual(['R1']);
  expect(observed.selectedNet).toBeNull();
});


it('uses the same net selection state for 2D terminals and 3D voltage labels', async () => {
  await mount();
  await enter('[data-endpoint-id="R1.a"]');
  await click('3D');
  const firstNet = observed.selectedNet!;
  expect(firstNet).toBeTruthy();
  expect(observed.selections.at(-1)).toEqual([]);
  await act(async () => observed.onSelect!('R1'));
  expect(observed.selectedNet).toBeNull();
  await act(async () => observed.onSelectNet!(firstNet));
  expect(observed.selectedNet).toBe(firstNet);
  expect(observed.selections.at(-1)).toEqual([]);
  await click('2D');
  await enter('[data-endpoint-id="R1.b"]');
  await click('3D');
  expect(observed.selectedNet).not.toBe(firstNet);
  expect(observed.selections.at(-1)).toEqual([]);
  await act(async () => observed.onSelect!(null));
  expect(observed.selectedNet).toBeNull();
  await click('전압 탐침');
  await click('3D');
  expect(observed.onSelectNet).toBeUndefined();
});
