// @vitest-environment happy-dom
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { examples } from '../src/fixtures';
import { layoutExample } from '../src/app/examples';
import { saveLocal, loadLocal, loadMeasurementNotebook } from '../src/persistence';
import type { Potential3DProps } from '../src/potential-3d';

const observed = vi.hoisted(() => ({ document: null as Potential3DProps['document'] | null, measurement: undefined as Potential3DProps['voltageMeasurement'], selections: [] as string[][] }));
vi.mock('../src/potential-3d', () => ({
  Potential3D: (props: Potential3DProps) => {
    observed.document = props.document;
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
  expect(button('측정값 기록').disabled).toBe(true);
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
  expect(host.querySelector<HTMLElement>('.measure-console')?.hidden).toBe(true);
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
  expect(host.querySelector('button[aria-label="빨강 탐침"]')).toBeNull();
  expect(button('2D에서 위치 변경')).toBeDefined();
  expect(toggle('색상').checked).toBe(false);
  expect(toggle('숫자').checked).toBe(false);
  await click('두 탐침 맞바꾸기');
  expect(observed.measurement?.label).toBe('-3 V');
  expect(observed.measurement?.red?.endpointId).toBe('R1.b');
  await click('측정값 기록');
  expect(loadMeasurementNotebook().entries[0].record.value).toBe(-3);
  await click('2D에서 위치 변경');
  expect(value()).toBe('-3 V');
  expect(host.querySelector('.circuit-canvas')!.getAttribute('viewBox')).toBe(view);
  expect(host.querySelector('[data-measurement-handle="red"]')).not.toBeNull();
  await click('측정 위치 지우기');
  await click('3D');
  expect(observed.measurement).toEqual({red:null,black:null,label:null});
  expect(button('측정값 기록').disabled).toBe(true);
  await click('도구 종료');
  expect(observed.measurement).toBeUndefined();
  expect(button('3D').getAttribute('aria-pressed')).toBe('true');
  expect(loadLocal()).toMatchObject({ok:true,document:doc});
});
