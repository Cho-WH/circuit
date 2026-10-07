// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import fixture from '../fixtures/FIX-13-forward-diode.json';
import bridgeFixture from '../fixtures/FIX-14-bridge-rectifier.json';
import { requireDocument, diodeProfileRef } from '../src/domain';
import * as q from '../src/rational';
import { saveLocal, loadLocal, serializeDocument, loadMeasurementNotebook } from '../src/persistence';
import { useCircuitSession, type WorkspaceMode } from '../src/app/useCircuitSession';
import { analyze } from '../src/app/analyze';
import { App } from '../src/app/App';
import { QUICK_START_SEEN_KEY } from '../src/app/useQuickStart';
import { createMeasurementRecord } from '../src/measurement';
import { measurementConditionKey, measurementValue } from '../src/app/measurement-records';
import { componentPresentation } from '../src/component-library';
import { exportSvg } from '../src/export';

let root: Root, host: HTMLDivElement, session: ReturnType<typeof useCircuitSession>;
function Harness({mode}: {mode: WorkspaceMode}) { session=useCircuitSession(mode); return null; }
function circuit(resistance=1000, adjustable=false) {
  const doc=requireDocument(fixture.document), resistor=doc.components.find(c=>c.id==='R1')!;
  resistor.properties.resistanceOhm=q.store(resistance);
  if(adjustable) {resistor.type='resistive-load';resistor.properties.resistanceMinOhm=q.store(1);resistor.properties.resistanceMaxOhm=q.store(1000);}
  return doc;
}

it('switches the bridge with the existing value control and inline action, including analysis and undo', async () => {
  saveLocal(requireDocument(bridgeFixture.document));
  await act(async () => root.render(createElement(App)));
  const click = async (label: string) => {
    const target = [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.getAttribute('aria-label') === label || b.textContent?.trim() === label)!;
    expect(target).toBeDefined(); await act(async () => target.click());
  };
  const value = () => host.querySelector('[data-value-id="S1"]')!;
  expect([...host.querySelectorAll('button')].some(b => b.textContent?.endsWith('전환 스위치'))).toBe(true);
  expect(host.querySelectorAll('[data-component-id="S1"] [data-endpoint-id]')).toHaveLength(3);
  await act(async () => value().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(value().textContent).toBe('B 연결');
  await click('실행 취소'); expect(value().textContent).toBe('A 연결');
  await act(async () => host.querySelector('[data-component-id="S1"] .component')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  await click('이름·값'); await click('B로 전환'); await click('취소');
  expect(value().textContent).toBe('B 연결');
  await click('분석하기');
  await act(async () => value().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(value().textContent).toBe('A 연결');
  act(() => vi.advanceTimersByTime(500));
  const loaded = loadLocal(); expect(loaded?.ok).toBe(true);
  if (loaded?.ok) expect(analyze(loaded.document).result.branchCurrents.R1).toEqual(q.rational(9n, 2500n));
  await click('회로도 출력');
  expect(host.querySelector('[data-output-id="S1"][data-output-part="body"]')?.textContent).toContain('A');
  expect(host.querySelector('[data-output-id="D1"][data-output-part="value"]')).toBeNull();
});

it('keeps changeover switching behind worksheet, activity and damage command guards', () => {
  const doc = requireDocument(bridgeFixture.document);
  saveLocal(doc); render('worksheet');
  act(() => { expect(session.execute({ type: 'SetProperties', id: 'S1', properties: { state: 'b' } }).ok).toBe(false); });
  act(() => session.changeWorkspace('analysis')); render('analysis');
  act(() => {
    expect(session.execute({ type: 'SetProperties', id: 'S1', properties: { state: 'b' } }).ok).toBe(true);
    expect(session.execute({ type: 'SetProperties', id: 'R1', properties: { resistanceOhm: q.store(1) } }).ok).toBe(true);
  });
  expect(session.analysisSession.phase).not.toBe('normal');
  act(() => { expect(session.execute({ type: 'SetProperties', id: 'S1', properties: { state: 'a' } }).ok).toBe(false); });
});
const render=(mode:WorkspaceMode)=>act(()=>root.render(createElement(Harness,{mode})));
const change=(value:number)=>session.execute({type:'SetProperties',id:'R1',properties:{resistanceOhm:q.store(value)}});
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers();localStorage.clear();
  localStorage.setItem(QUICK_START_SEEN_KEY,'true');
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();localStorage.clear();});

it('locks damage and the last value synchronously, including queued edits and undo, and restores only the session',()=>{
  saveLocal(circuit(1000,true));render('build');
  act(()=>session.changeWorkspace('analysis'));render('analysis');
  expect(session.analysisSession.phase).toBe('normal');
  act(()=>{
    expect(change(1).ok).toBe(true);
    expect(change(1000).ok).toBe(false);
    session.undo();session.redo();
    expect(session.canMeasure()).toBe(false);
  });
  expect(session.analysisSession.phase).toBe('breaking');
  expect(session.history.present.components[1].properties.resistanceOhm).toEqual(q.store(1));
  act(()=>vi.advanceTimersByTime(500));expect(session.analysisSession.phase).toBe('broken');
  const saved=serializeDocument(session.history.present);expect(saved).not.toContain('broken');
  const last=session.history.present;
  act(()=>session.changeWorkspace('build'));render('build');
  expect(session.history.present).toBe(last);expect(session.canMeasure()).toBe(true);
  expect(analyze(last).assessment.status).toBe('damage');
  act(()=>session.changeWorkspace('analysis'));render('analysis');
  expect(session.analysisSession.phase).toBe('breaking');
});

it('freezes overload at the accepted value until reset while keeping measurements available',()=>{
  saveLocal(circuit());render('build');
  act(()=>session.changeWorkspace('analysis'));render('analysis');
  expect(session.analysisSession.componentModel).toBe(false);
  act(()=>change(10));expect(session.analysisSession.phase).toBe('overload');
  const frozen=session.analysisSession, last=session.history.present;
  act(()=>{
    expect(change(9).ok).toBe(false);
    expect(change(1000).ok).toBe(false);
    expect(session.execute({type:'SetProperties',id:'V1',properties:{voltageV:q.store(1)}}).ok).toBe(false);
    session.undo();session.redo();
  });
  expect(session.history.present).toBe(last);expect(session.analysisSession).toBe(frozen);
  expect(session.canChangeValues()).toBe(false);expect(session.canMeasure()).toBe(true);
  expect(session.analysisSession.componentModel).toBe(true);
  act(()=>session.changeWorkspace('build'));render('build');
  expect(session.history.present).toBe(last);expect(session.canChangeValues()).toBe(true);
  act(()=>session.changeWorkspace('analysis'));render('analysis');
  expect(session.analysisSession.phase).toBe('overload');
  act(()=>session.changeWorkspace('build'));render('build');
  act(()=>expect(change(1000).ok).toBe(true));
  act(()=>session.changeWorkspace('analysis'));render('analysis');
  expect(session.analysisSession.phase).toBe('normal');expect(session.analysisSession.componentModel).toBe(false);
});

it('shows only a build warning, then damage decoration, a short cause and a working repair path',async()=>{
  saveLocal(circuit(1));await act(async()=>root.render(createElement(App)));
  const button=(name:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.getAttribute('aria-label')===name||b.textContent?.trim()===name)!;
  expect(button('파손 주의')).toBeTruthy();expect(host.querySelector('[data-operating-state]')).toBeNull();
  await act(async()=>button('분석하기').click());
  expect(host.querySelector('[data-component-id="D1"]')?.getAttribute('data-operating-state')).toBe('breaking');
  await act(async()=>vi.advanceTimersByTime(500));
  expect(host.querySelector('[data-component-id="D1"]')?.getAttribute('data-operating-state')).toBe('broken');
  expect(host.querySelector('[data-endpoint-id="D1.a"]')?.textContent).not.toContain('0.7 V');
  const tools=[...host.querySelectorAll<HTMLButtonElement>('.analysis-tools button')];
  expect(tools).toHaveLength(3);expect(tools.every(b=>b.disabled)).toBe(true);
  expect(host.querySelector('.measure-diagnostics')).toBeNull();
  await act(async()=>button('회로 초기화').click());
  expect(host.querySelector('[data-operating-state]')).toBeNull();expect(button('파손 주의')).toBeTruthy();
});

it('keeps overload voltage/current recording available with disabled value controls and a reset beside the warning',async()=>{
  saveLocal(circuit(10,true));await act(async()=>root.render(createElement(App)));
  const button=(name:string)=>[...document.body.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.getAttribute('aria-label')===name||b.textContent?.trim()===name||b.querySelector(':scope > span:last-child')?.textContent===name)!;
  const click=async(name:string)=>act(async()=>button(name).click());
  const enter=async(selector:string)=>act(async()=>host.querySelector(selector)!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
  await click('분석하기');
  expect(host.querySelector('[data-component-id="D1"]')?.getAttribute('data-operating-state')).toBe('overload');
  expect(host.querySelector('.physical-model-badge')).toBeNull();
  expect(button('과부하 주의').closest('.canvas-status-actions')).toContain(button('회로 초기화'));
  await enter('[data-component-id="R1"] .component');
  expect(host.querySelector<HTMLFieldSetElement>('.parameter-control')?.disabled).toBe(true);
  expect(host.querySelector<HTMLFieldSetElement>('.component-properties')?.disabled).toBe(true);
  expect(host.querySelector('[aria-label="R1 값 편집"]')).toBeNull();
  expect(button('등가저항').disabled).toBe(true);
  await click('전압 탐침');
  await enter('[data-endpoint-id="D1.a"]');await enter('[data-endpoint-id="D1.b"]');
  expect(host.querySelector('output[aria-label="측정값"]')?.textContent).toContain('≈');
  expect(button('측정값 기록').disabled).toBe(false);await click('측정값 기록');
  await click('전류 센서');await enter('[data-component-id="D1"] .component');
  expect(host.querySelector('output[aria-label="측정값"]')?.textContent).toContain('≈');
  await click('측정값 기록');
  const records=loadMeasurementNotebook().entries;
  expect(records.map(e=>e.record.quantity)).toEqual(['voltage','current']);
  expect(records.every(e=>e.record.provenance?.physicalModel==='component')).toBe(true);
  await click('회로 초기화');
  expect(host.querySelector('[data-operating-state]')).toBeNull();expect(button('과부하 주의')).toBeTruthy();
  expect(host.querySelector<HTMLFieldSetElement>('.component-properties')?.disabled).toBe(false);
});

it('keeps physical help available outside locked fields, with one dialog and unchanged measurement state', async () => {
  saveLocal(circuit(10, true)); await act(async () => root.render(createElement(App)));
  const button = (name: string) => [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(b => b.getAttribute('aria-label') === name || b.textContent?.trim() === name)!;
  await act(async () => button('분석하기').click());
  await act(async () => host.querySelector('[data-component-id="D1"] .component')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  // happy-dom has no viewport geometry: the same explanation is available in component details.
  const trigger = host.querySelector<HTMLButtonElement>('.operating-help-fallback button')!;
  expect(trigger).toBeTruthy(); expect(trigger.closest('fieldset')).toBeNull(); expect(trigger.disabled).toBe(false);
  const saved = loadLocal();
  await act(async () => trigger.click());
  expect(document.querySelectorAll('.operating-help-content')).toHaveLength(1);
  expect(document.querySelector('.operating-help-content')?.textContent).toContain('순방향인데 왜 문제가 생겼나요?');
  await act(async () => button('다이오드 전압은 항상 0.7 V 아닌가요?').click());
  expect(document.activeElement?.textContent).toBe('다이오드 전압은 항상 0.7 V 아닌가요?');
  expect(document.querySelectorAll('.operating-help-content')).toHaveLength(1);
  await act(async () => button('설명 닫기').click());
  expect(document.activeElement).toBe(trigger);
  await act(async () => trigger.click());
  await act(async () => button('과부하 주의').click());
  expect(document.querySelector('.operating-help-content')).toBeNull();
  expect(document.querySelector('.canvas-diagnostics-bubble')).not.toBeNull();
  await act(async () => trigger.click());
  expect(document.querySelector('.canvas-diagnostics-bubble')).toBeNull();
  expect(host.querySelector<HTMLFieldSetElement>('.component-properties')!.disabled).toBe(true);
  expect(loadLocal()).toEqual(saved);
  await act(async () => button('회로 초기화').click());
  expect(document.querySelector('.operating-help-content')).toBeNull();
  expect(host.querySelector('.operating-help-fallback')).toBeNull();
});

it('keeps model/profile provenance in measurement grouping and uses a display approximation only',()=>{
  const doc=circuit(10), evaluated=analyze(doc), value=evaluated.result.branchCurrents.D1;
  const saved=createMeasurementRecord(doc,{condition:'정상 연결',quantity:'current',source:'simulation',value,unit:'A',targetIds:['D1'],provenance:evaluated.result.provenance});
  expect(saved.ok).toBe(true);if(!saved.ok)return;
  const entry={id:'one',record:saved.value,note:'',sourcesDisconnected:false,anchors:{red:null,black:null,current:null}};
  expect(measurementValue(entry)).toContain('≈');expect(value.approximation).toBeUndefined();
  const other={...entry,record:{...entry.record,provenance:{...entry.record.provenance!,physicalModel:'textbook' as const}}};
  expect(measurementConditionKey(other)).not.toBe(measurementConditionKey(entry));
  const diode=doc.components.find(c=>c.id==='D1')!;
  diode.properties.showVoltage=true;diode.properties.showCurrent=true;diode.properties.quantityMode='plain';
  const presentation=componentPresentation(diode,evaluated.result);
  expect(presentation.value).toBeNull();
  expect(presentation.voltage).toContain('≈');expect(presentation.current).toContain('≈');
  expect(exportSvg(doc,{},evaluated.result)).toContain('≈');
});


it('blocks kind changes through commands and history in analysis and output, then permits them in build', () => {
  saveLocal(circuit()); render('build');
  act(() => { expect(session.execute({ type: 'SetDiodeKind', id: 'D1', kind: 'power' }).ok).toBe(true); });
  const power = session.history.present;
  for (const mode of ['analysis', 'worksheet'] as const) {
    act(() => session.changeWorkspace(mode)); render(mode);
    expect(session.canUndo()).toBe(false);
    act(() => {
      expect(session.execute({ type: 'SetDiodeKind', id: 'D1', kind: 'signal' }).ok).toBe(false);
      session.undo();
    });
    expect(session.history.present).toEqual(power);
  }
  act(() => session.changeWorkspace('build')); render('build');
  act(() => session.undo());
  const signal = session.history.present;
  act(() => session.changeWorkspace('analysis')); render('analysis');
  expect(session.canRedo()).toBe(false);
  act(() => session.redo()); expect(session.history.present).toEqual(signal);
  act(() => session.changeWorkspace('build')); render('build');
  expect(session.canRedo()).toBe(true);
  act(() => session.redo()); expect(session.history.present).toEqual(power);
});

it.each([10, 1])('does not use kind replacement to recover an overloaded or damaged circuit at %s ohms', resistance => {
  saveLocal(circuit(resistance)); render('build');
  act(() => session.changeWorkspace('analysis')); render('analysis');
  const before = session.history.present;
  expect(session.analysisSession.phase).not.toBe('normal');
  act(() => { expect(session.execute({ type: 'SetDiodeKind', id: 'D1', kind: 'power' }).ok).toBe(false); });
  expect(session.history.present).toBe(before);
});

it('reuses name/value editing for two kinds, cancel and one-step name/kind undo with a single note', async () => {
  const doc = circuit(); doc.components.find(c => c.id === 'D1')!.operatingProfile = diodeProfileRef('signal');
  saveLocal(doc);
  await act(async () => root.render(createElement(App)));
  const click = async (label: string) => {
    const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.getAttribute('aria-label') === label || b.textContent?.trim() === label)!;
    expect(button).toBeDefined(); await act(async () => button.click());
  };
  const open = async () => {
    await act(async () => host.querySelector('[data-component-id="D1"] .component')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await click('이름·값');
  };
  const choose = async (value: string) => {
    const select = host.querySelector<HTMLSelectElement>('.inline-value-editor .diode-kind-select')!;
    await act(async () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
  };
  const savedDiode = () => { const loaded = loadLocal(); if (!loaded?.ok) throw new Error('Missing saved circuit'); return loaded.document.components.find(c => c.id === 'D1')!; };
  const valueLabel = () => host.querySelector('[data-value-id="D1"]')!;
  expect(valueLabel().textContent).toBe('신호용');
  expect(Number(valueLabel().getAttribute('font-size'))).toBeLessThan(Number(host.querySelector('[data-component-label="D1"]')!.getAttribute('font-size')));
  await open();
  const options = [...host.querySelectorAll('.inline-value-editor .diode-kind-select option')].map(o => o.textContent);
  expect(options).toEqual(['신호용', '대전류용']);
  expect(host.querySelector<HTMLSelectElement>('.inline-value-editor .diode-kind-select')!.value).toBe('signal');
  expect(host.querySelector('.inline-value-editor .diode-kind-note')!.textContent).toBe('작은 전류가 흐르는 회로에 사용해요.');
  await choose('power');
  expect(host.querySelector('.inline-value-editor .diode-kind-note')!.textContent).toBe('큰 전류도 버틸 수 있어요.');
  expect(savedDiode().operatingProfile).toEqual(diodeProfileRef('signal'));
  await click('취소'); await open();
  expect(host.querySelector<HTMLSelectElement>('.inline-value-editor .diode-kind-select')!.value).toBe('signal');
  await choose('power');
  const input = host.querySelector<HTMLInputElement>('#inline-component-name')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '큰 다이오드'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await click('적용'); act(() => vi.advanceTimersByTime(500));
  expect(valueLabel().textContent).toBe('대전류용');
  expect(savedDiode()).toMatchObject({ label: '큰 다이오드', operatingProfile: diodeProfileRef('power') });
  await click('실행 취소'); act(() => vi.advanceTimersByTime(500));
  expect(valueLabel().textContent).toBe('신호용');
  expect(savedDiode()).toMatchObject({ label: 'D1', operatingProfile: diodeProfileRef('signal') });
  await click('다시 실행'); act(() => vi.advanceTimersByTime(500));
  expect(savedDiode().operatingProfile).toEqual(diodeProfileRef('power'));
  await click('분석하기');
  await act(async () => host.querySelector('[data-value-id="D1"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(host.querySelector<HTMLSelectElement>('.inline-value-editor .diode-kind-select')!.disabled).toBe(true);
  await click('취소');
  await click('회로도 출력');
  const outputValue = () => host.querySelector('[data-output-id="D1"][data-output-part="value"]');
  expect(outputValue()).toBeNull();
  await act(async () => host.querySelector('[data-output-id="D1"][data-output-part="body"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  const toggle = () => host.querySelector<HTMLInputElement>('[aria-label="종류 표시"]')!;
  expect(toggle().checked).toBe(false);
  await act(async () => toggle().click());
  expect(outputValue()?.textContent).toBe('대전류용');
  expect(toggle().checked).toBe(true);
  await click('출력 실행 취소');
  expect(outputValue()).toBeNull();
});
