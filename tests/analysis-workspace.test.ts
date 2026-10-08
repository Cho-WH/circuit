import * as q from '../src/rational';
// @vitest-environment happy-dom
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { QUICK_START_SEEN_KEY } from '../src/app/useQuickStart';
import { examples } from '../src/fixtures';
import { layoutExample } from '../src/app/examples';
import { createComponent, wirePoints } from '../src/component-library';
import { copySelection } from '../src/editor';
import { createDocumentIdAllocator } from '../src/domain';
import { analyze } from '../src/app/analyze';
import { buildCurrentModel, buildPotentialModel } from '../src/visualization';
import { saveLocal, loadLocal, loadMeasurementNotebook } from '../src/persistence';
import type { Potential3DProps } from '../src/potential-3d';
import { meterCircuit } from './meter-fixture';

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
  localStorage.setItem(QUICK_START_SEEN_KEY, 'true');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const button = (name: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) =>
      b.getAttribute('aria-label') === name ||
      b.textContent?.trim() === name ||
      b.querySelector(':scope > span:last-child')?.textContent === name,
  )!;
const click = (name: string) => act(async () => button(name).click());

it('hides automatic ground symbols and reference footers for disconnected parts in build and analysis', async () => {
  const doc=structuredClone(examples.find(e=>e.document.documentId==='fix-02')!.document);
  doc.referenceNode=null;
  doc.components.push(createComponent('resistor','loose',{x:900,y:600}));
  saveLocal(doc);
  await act(async()=>root.render(createElement(App)));
  expect(button('접지')).toBeDefined();
  expect(host.querySelector('[data-reference-handle]')).toBeNull();
  await click('분석하기');
  expect(host.querySelector('[data-reference-handle]')).toBeNull();
  expect(host.querySelector('.potential-reference')).toBeNull();
  expect(host.textContent).not.toContain('0 V 기준:');
  expect(analyze(doc).result.referenceGroups!.length).toBeGreaterThan(1);
});
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

it('rotates a selected component twice without moving wires and restores each step with undo', async () => {
  vi.useFakeTimers();
  const action = async (name: string) => {
    await click(name);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  };
  const doc = layoutExample(examples.find(e => e.id === 'FIX-02')!.document);
  saveLocal(doc);
  await act(async () => root.render(createElement(App)));
  await enter('[data-component-id="R1"] .component');
  const saved = () => {
    const loaded = loadLocal();
    if (!loaded?.ok) throw new Error('Expected saved circuit');
    return loaded.document;
  };
  const paths = () => saved().wires.map(w => wirePoints(saved(), w));
  const originalPaths = paths();
  await action('회전');
  const first = saved();
  expect(paths()).toEqual(originalPaths);
  expect(first.wires.some(w => [w.start, w.end].some(e => e.id === 'R1.a' || e.id === 'R1.b'))).toBe(false);
  await action('회전');
  expect(paths()).toEqual(originalPaths);
  expect(saved().wires).toEqual(doc.wires.map(w => ({ ...w,
    start: { ...w.start, id: w.start.id === 'R1.a' ? 'R1.b' : w.start.id === 'R1.b' ? 'R1.a' : w.start.id },
    end: { ...w.end, id: w.end.id === 'R1.a' ? 'R1.b' : w.end.id === 'R1.b' ? 'R1.a' : w.end.id },
  })));
  await action('실행 취소'); expect(saved()).toEqual(first);
  await action('실행 취소'); expect(saved()).toEqual(doc);
});

it('keeps multiple meter displays open across selection, tools and views, updates values and collapses only the chosen meter', async () => {
  const doc = meterCircuit(); saveLocal(doc);
  await act(async () => root.render(createElement(App)));
  expect(button('A_1 계기값 펼치기')).toBeUndefined();
  await click('분석하기');
  await click('A_1 계기값 펼치기'); await click('M_1 계기값 펼치기');
  const reading = (name: string) => host.querySelector(`output[aria-label="${name} 측정값"]`)?.textContent;
  expect(reading('A_1')).toBe('1 A'); expect(reading('M_1')).toBe('3 V');
  await act(async () => toggle('숫자').click());
  await enter('[data-component-id="S1"] .component');
  await click('스위치 열기');
  expect(reading('A_1')).toBe('0 A'); expect(reading('M_1')).toBe('0 V');
  await click('스위치 닫기');
  await click('전압 탐침'); await probeResistor();
  expect(reading('M_1')).toBe(value());
  await click('3D');
  expect(reading('A_1')).toBe('1 A'); expect(reading('M_1')).toBe('3 V');
  await click('2D'); await click('등가저항'); await click('전원 분리하고 측정');
  expect(reading('A_1')).toBe('— A'); expect(reading('M_1')).toBe('— V');
  await click('도구 종료');
  expect(reading('A_1')).toBe('1 A');
  await act(async () => host.querySelector('.circuit-canvas')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(reading('M_1')).toBe('3 V');
  await click('A_1 계기값 축소');
  expect(reading('A_1')).toBeUndefined(); expect(reading('M_1')).toBe('3 V');
  await click('회로도 출력');
  expect(host.querySelector('.meter-readouts')).toBeNull();
  await click('분석하기'); expect(reading('M_1')).toBe('3 V');
  const loaded = loadLocal();
  if (!loaded?.ok) throw new Error('Expected current circuit to remain saved');
  const saved = loaded.document;
  expect(saved.components).toEqual(doc.components);
  expect(saved.wires).toEqual(doc.wires);
});

it('forgets deleted meter displays and resets them when a document is replaced', async () => {
  saveLocal(meterCircuit());
  await act(async () => root.render(createElement(App)));
  await click('분석하기'); await click('A_1 계기값 펼치기'); await click('M_1 계기값 펼치기');
  await click('회로 만들기'); await enter('[data-component-id="A1"] .component');
  await act(async () => host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })));
  await click('실행 취소'); await click('분석하기');
  expect(host.querySelector('output[aria-label="A_1 측정값"]')).toBeNull();
  expect(host.querySelector('output[aria-label="M_1 측정값"]')).not.toBeNull();
  await click('회로 만들기'); await click('빈 회로 만들기');
  await click('실행 취소'); await click('분석하기');
  expect(host.querySelectorAll('.meter-readouts output')).toHaveLength(0);
});

it('keeps two copied circuits usable and refuses cross-reference recording in 2D and 3D', async () => {
  const doc = layoutExample(examples.find(e => e.id === 'FIX-13')!.document);
  const copy = copySelection(doc, [...doc.components, ...doc.wires, ...doc.junctions].map(e => e.id), createDocumentIdAllocator(doc), { x: 0, y: 500 });
  doc.components.push(...copy.components); doc.wires.push(...copy.wires); doc.junctions.push(...copy.junctions);
  saveLocal(doc);
  await act(async () => root.render(createElement(App)));
  expect(host.querySelectorAll('[data-reference-handle]')).toHaveLength(1);
  expect(host.querySelector('.potential-reference')).toBeNull();
  await click('분석하기'); await click('전압 탐침');
  const other = copy.components.find(c => c.type === 'resistor')!;
  await enter('[data-endpoint-id="R1.a"]');
  await enter(`[data-endpoint-id="${other.terminals[0].id}"]`);
  expect(value()).toBe('— V');
  expect(host.textContent).toContain('서로 독립된 기준이라 전압을 비교할 수 없어요');
  expect(button('측정값 기록').disabled).toBe(true);
  expect([...host.querySelectorAll('.measure-probe-potential')].map(el => el.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('· A'), expect.stringContaining('· B')]));
  await click('3D');
  expect(observed.measurement?.label).toBeNull();
  await click('2D');
  await click('빨강 탐침'); await enter(`[data-endpoint-id="${other.terminals[1].id}"]`);
  expect(value()).toBe('-4.3 V');
  expect(button('측정값 기록').disabled).toBe(false);
  await click('측정값 기록');
  expect(loadMeasurementNotebook().entries).toHaveLength(1);
  expect(loadMeasurementNotebook().entries[0].record.provenance?.profileRevision).toContain('references:independent-1');
});

it('switches the selected bridge beside voltage probes and preserves their positions in 2D and 3D', async () => {
  saveLocal(layoutExample(examples.find(e => e.id === 'FIX-14')!.document));
  await act(async () => root.render(createElement(App)));
  await click('분석하기'); await click('전압 탐침'); await probeResistor();
  const before = value();
  expect(before).toBe('3.6 V');
  await enter('[data-component-id="S1"] .component');
  expect(host.querySelector('.parameter-panel:not([hidden])')?.getAttribute('aria-label')).toBe('전환 스위치 조절');
  await click('측정값 기록'); await click('B로 전환');
  expect(value()).toBe(before);
  expect(button('전압 탐침').getAttribute('aria-pressed')).toBe('true');
  await click('측정값 기록');
  expect(loadMeasurementNotebook().entries.map(e => e.record.documentSnapshot.components.find(c => c.id === 'S1')!.properties.state)).toEqual(['a', 'b']);
  await click('3D');
  const scene = host.querySelector('[data-test-scene]');
  await click('A로 전환');
  expect(host.querySelector('[data-test-scene]')).toBe(scene);
  expect(observed.measurement?.red?.endpointId).toBe('R1.a');
  expect(observed.measurement?.black?.endpointId).toBe('R1.b');
  expect(value()).toBe(before);
  await act(async () => observed.onSelect!(null));
  expect(host.querySelector('.parameter-panel:not([hidden])')).toBeNull();
});

it('reuses the same measurement panel for an ordinary switch', async () => {
  saveLocal(layoutExample(examples.find(e => e.id === 'FIX-05')!.document));
  await act(async () => root.render(createElement(App)));
  await click('분석하기'); await click('전류 센서');
  await enter('[data-component-id="S1"] .component');
  expect(host.querySelector('.parameter-panel:not([hidden])')?.getAttribute('aria-label')).toBe('스위치 조절');
  await click('스위치 닫기');
  expect(button('스위치 열기')).toBeDefined();
  expect(button('전류 센서').getAttribute('aria-pressed')).toBe('true');
});

it('measures and records zero diode voltage with an open switch, sharing exact zero current and finite 3D heights', async () => {
  const doc=layoutExample(examples.find(e=>e.id==='FIX-13')!.document);
  const sw=createComponent('switch','S1',{x:400,y:160});
  sw.properties.state='closed';
  doc.components.push(sw);
  const wire=doc.wires.find(w=>w.id==='W1')!,originalEnd=wire.end;
  wire.end={kind:'terminal',id:'S1.a'};
  doc.wires.push({id:'switch-wire',start:{kind:'terminal',id:'S1.b'},end:originalEnd,waypoints:[]});
  saveLocal(doc);
  await act(async()=>root.render(createElement(App)));
  await click('분석하기');await click('전압 탐침');
  await enter('[data-endpoint-id="D1.a"]');await enter('[data-endpoint-id="D1.b"]');
  expect(value()).toBe('700 mV');
  await enter('[data-component-id="S1"] .component');
  await click('스위치 열기');
  expect(value()).toBe('0 V');
  await click('측정값 기록');
  const record=loadMeasurementNotebook().entries.at(-1)!.record;
  expect(record.value).toEqual(q.store(0));
  expect(record.provenance?.profileRevision).toContain('diode-equilibrium-1|');
  const snapshot=record.documentSnapshot;
  expect(snapshot.components.find(c=>c.id==='S1')!.properties.state).toBe('open');
  const {compilation,result,assessment}=analyze(snapshot);
  expect(assessment.status).toBe('normal');
  expect(result.solution).toBe('unique');
  expect(result.branchCurrents.D1).toEqual(q.ZERO);
  const current=buildCurrentModel(snapshot,compilation,result);
  expect(current.samples.every(sample=>sample.value.status==='known'&&q.sign(sample.value.amperes)===0)).toBe(true);
  const potential=buildPotentialModel(snapshot,compilation.circuit,result);
  expect(potential.undefinedCount).toBe(0);
  expect(potential.endpoints['D1.a'].height).toBe(potential.endpoints['D1.b'].height);
  await click('3D');
  expect(value()).toBe('0 V');
  expect(observed.measurement?.label).toBe('0 V');
  await click('스위치 닫기');
  expect(value()).toBe('700 mV');
  expect(observed.measurement?.red?.endpointId).toBe('D1.a');
});

it.each(['activity', 'damage'] as const)('disables switch panel actions for %s restrictions', async reason => {
  const doc = layoutExample(examples.find(e => e.id === 'FIX-14')!.document);
  if (reason === 'activity') doc.activity = { allowedCommands: [], revealSteps: [] };
  else doc.components.find(c => c.id === 'R1')!.properties.resistanceOhm = q.store(1);
  saveLocal(doc);
  await act(async () => root.render(createElement(App)));
  await click('분석하기');
  await enter('[data-component-id="S1"] .component');
  expect(button('B로 전환').disabled).toBe(true);
});

it.each(['resistance', 'voltage'] as const)('adjusts %s beside the probes and records exact conditions without restarting 3D', async (kind) => {
  const doc = layoutExample(examples.find(e => e.id === 'FIX-02')!.document);
  const variable = doc.components.find(c => c.id === 'R1')!;
  variable.type = 'resistive-load'; variable.properties = { resistanceOhm: q.store(3), resistanceMinOhm: q.store(3), resistanceMaxOhm: q.store(6) };
  doc.components.find(c => c.id === 'R2')!.properties.resistanceOhm = q.store(3);
  const source = doc.components.find(c => c.type === 'dc-voltage-source')!;
  const adjusted = kind === 'voltage' ? source : variable;
  const property = kind === 'voltage' ? 'voltageV' : 'resistanceOhm';
  if (kind === 'voltage') {
    variable.type = 'resistor';
    variable.properties = {resistanceOhm:q.store(3)};
    source.properties = createComponent('adjustable-voltage-source',source.id,source.position).properties;
  }
  saveLocal(doc);
  await act(async () => root.render(createElement(App)));
  await click('분석하기');
  expect(host.querySelector('.parameter-panel:not([hidden])')).toBeNull();
  await click('전압 탐침'); await probeResistor();
  await enter(`[data-component-id="${adjusted.id}"] .component`);
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
  expect(value()).toBe(kind === 'voltage' ? '3 V' : '6 V');
  expect(observed.measurement?.label).toBe(value());
  expect(host.querySelector('[data-test-scene]')).toBe(scene);
  expect(host.querySelector('.potential-workspace')!.getAttribute('data-status')).toBe('ready');
  expect(observed.measurement?.red?.endpointId).toBe('R1.a');
  await click('측정값 기록');
  const records = loadMeasurementNotebook().entries;
  expect(records.map(e => e.record.value === null ? null : q.toNumber(e.record.value))).toEqual([4.5, kind === 'voltage' ? 3 : 6]);
  expect(records.map(e => q.toNumber(e.record.documentSnapshot.components.find(c => c.id === adjusted.id)!.properties[property] as q.Scalar))).toEqual([kind === 'voltage' ? 9 : 3, 6]);
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
  await click('전원 분리하고 측정');
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
  await click('전원 분리하고 측정');
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
  expect(button('전원 분리하고 측정')).toBeUndefined();
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
  expect(button('측정 위치 지우기')).toBeUndefined();
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
