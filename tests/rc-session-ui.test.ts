// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { RcParameterControl } from '../src/app/parameters/RcParameterControl';
import { useCircuitSession, type WorkspaceMode } from '../src/app/useCircuitSession';
import { QUICK_START_SEEN_KEY } from '../src/app/useQuickStart';
import { adjustableParameter } from '../src/component-library';
import { saveLocal, loadLocal, loadMeasurementNotebook } from '../src/persistence';
import { emptyDocument, rcPolicy } from '../src/domain';
import * as q from '../src/rational';
import { rcSessionDocument } from './rc-session-fixture';
import { compileCircuit } from '../src/connectivity';
import { rcEngine, rcCircuitRevision, rcInitialState, observeRcFrame } from '../src/simulation';
import { buildPotentialModel } from '../src/visualization';
import { createSvgExport } from '../src/export';

let host: HTMLDivElement, root: Root, session: ReturnType<typeof useCircuitSession>;
let now: number, frames: Map<number, FrameRequestCallback>, nextFrame: number;
function Harness({ mode }: { mode: WorkspaceMode }) {
  session = useCircuitSession(mode);
  return null;
}
const render = (mode: WorkspaceMode) =>
  act(async () => root.render(createElement(Harness, { mode })));
const button = (label: string) =>
  [...host.querySelectorAll('button')].find(
    (b) =>
      b.getAttribute('aria-label') === label ||
      b.textContent?.trim() === label ||
      b.querySelector(':scope > span:last-child')?.textContent?.trim() === label,
  )!;
const click = (label: string) => act(async () => button(label).click());
const input = (node: HTMLInputElement, text: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, text);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  now = 0;
  frames = new Map();
  nextFrame = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => {
    frames.set(++nextFrame, run);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each([0,90,180,270] as const)('colors capacitor plates by terminal role at %i° and restores plain ink when colors are off', async rotation => {
  const doc=rcSessionDocument(10), capacitor=doc.components.find(c=>c.id==='C')!;
  capacitor.rotation=rotation; capacitor.terminals.reverse();
  const circuit=compileCircuit(doc).circuit;
  const plan=rcEngine.prepare({circuit,initialState:rcInitialState(circuit),circuitRevision:rcCircuitRevision(circuit),operationIndex:0,transition:'initial',policy:rcPolicy});
  expect(plan.ok).toBe(true);if(!plan.ok)return;
  const sample=rcEngine.sample(plan.value,{kind:'equilibrium'});
  expect(sample.ok).toBe(true);if(!sample.ok)return;
  const potential=buildPotentialModel(doc,circuit,observeRcFrame(sample.value));
  saveLocal(doc);
  await act(async()=>root.render(createElement(App)));
  await click('분석하기');
  const plate=(role:string)=>host.querySelector(`[data-component-id="C"] [data-capacitor-plate="${role}"]`)!;
  const colors=()=>['a','b'].map(role=>plate(role).getAttribute('stroke'));
  const expected=['a','b'].map(role=>potential.endpoints[`C.${role}`].color);
  expect(colors()).toEqual(expected);expect(expected[0]).not.toBe(expected[1]);
  act(()=>host.querySelector('[data-component-id="C"] .component')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
  expect(colors()).toEqual(expected);
  expect(plate('a').closest('.component-ink')?.getAttribute('transform')).toContain(`rotate(${rotation})`);
  const colorToggle=host.querySelector<HTMLInputElement>('input[aria-label="색상"]') ?? [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(e=>e.parentElement?.textContent?.trim()==='색상')!;
  expect(colorToggle).toBeDefined();
  act(()=>colorToggle.click());expect(colors()).toEqual([null,null]);
  act(()=>colorToggle.click());expect(colors()).toEqual(expected);
  const output=createSvgExport(doc,{}).svg;
  const printedPlates=output.match(/<path data-capacitor-plate="[^"]+"[^>]*>/g)!;
  expect(printedPlates).toHaveLength(2);
  expect(printedPlates.every(path=>!path.includes(' stroke='))).toBe(true);
  expect(output).toMatch(/data-output-id="C" data-output-part="body"[^>]*stroke="#111111"/);
});

it('locks every hook command/history bypass, applies atomically, restores history after leaving and saves only the document', async () => {
  const doc = rcSessionDocument(10);
  saveLocal(doc);
  await render('analysis');
  expect(session.rcSession?.phase).toBe('equilibrium');
  await act(async () => {
    expect(
      (
        await session.applyRc({
          type: 'SetProperties',
          id: 'V',
          properties: { voltageV: q.store(5) },
        })
      ).ok,
    ).toBe(true);
  });
  const committed = session.history;
  expect(committed.past).toHaveLength(1);
  expect(session.rcSession?.phase).toBe('running');
  act(() => {
    expect(
      session.execute({ type: 'SetProperties', id: 'V', properties: { voltageV: q.store(3) } }).ok,
    ).toBe(false);
    expect(session.execute({ type: 'SetReference', endpoint: null }).ok).toBe(false);
    expect(session.canUndo()).toBe(false);
    session.undo();
    session.redo();
  });
  expect(session.history).toBe(committed);
  expect(session.canChangeValues()).toBe(false);
  expect(session.canMeasure()).toBe(false);
  act(() => {
    now = 1000;
    session.rcPlayback.pause();
  });
  expect(session.canMeasure()).toBe(true);
  expect(session.canChangeValues()).toBe(false);
  act(() => vi.advanceTimersByTime(500));
  const saved = loadLocal();
  expect(saved?.ok && saved.document).toEqual(committed.present);
  await render('build');
  expect(session.rcSession).toBeNull();
  expect(session.canUndo()).toBe(true);
  act(() => session.undo());
  expect(session.history.present).toEqual(doc);
  act(() => session.redo());
  expect(session.history.present).toEqual(committed.present);
  await render('analysis');
  expect(session.rcSession?.operationIndex).toBe(0);
  expect(q.equal(session.rcSession!.frame!.capacitorState[0].voltageV, 10)).toBe(true);
  await act(async () => {
    await session.rcPlayback.restart();
  });
  expect(session.history.present.components[0].properties.voltageV).toEqual(q.store(5));
});

it('file replacement invalidates pending preparation and restores the DC path', async () => {
  saveLocal(rcSessionDocument(10));
  await render('analysis');
  let pending: Promise<unknown>;
  await act(async () => {
    pending = session.applyRc({
      type: 'SetProperties',
      id: 'V',
      properties: { voltageV: q.store(5) },
    });
    expect(session.execute({ type: 'ReplaceDocument', document: emptyDocument('opened') }).ok).toBe(
      true,
    );
    await pending;
  });
  expect(session.rcSession).toBeNull();
  expect(session.history.present.documentId).toBe('opened');
  expect(session.history.past).toHaveLength(1);
  expect(session.canUndo()).toBe(true);
  await act(async () => session.undo());
  expect(session.history.present.documentId).toBe('rc-session');
  expect(session.rcSession?.phase).toBe('equilibrium');
  expect(session.canUndo()).toBe(false);
});

it('hides and returns with no time jump and cancels rAF after leaving', async () => {
  saveLocal(rcSessionDocument());
  await render('analysis');
  now = 1000;
  act(() => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(session.rcSession?.phase).toBe('paused');
  expect(session.rcSession?.seconds).toBe(1);
  now = 100000;
  act(() => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(session.rcSession?.seconds).toBe(1);
  expect(session.rcSession?.phase).toBe('paused');
  await render('worksheet');
  expect(session.rcSession).toBeNull();
  expect(frames.size).toBe(0);
});

it('slider release and text blur keep drafts, explicit apply preserves a failed draft', async () => {
  const c = rcSessionDocument().components[0],
    parameter = adjustableParameter(c)!;
  const apply = vi.fn(async () => false);
  await act(async () =>
    root.render(
      createElement(RcParameterControl, {
        component: c,
        parameter,
        disabled: false,
        onApply: apply,
      }),
    ),
  );
  const slider = host.querySelector<HTMLInputElement>('[type=range]')!;
  input(slider, '500');
  act(() => {
    slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    slider.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
  const field = host.querySelector<HTMLInputElement>('input:not([type=range])')!;
  expect(field.value).toBe('6');
  expect(apply).not.toHaveBeenCalled();
  input(field, '5');
  act(() => field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
  expect(apply).not.toHaveBeenCalled();
  await click('적용');
  expect(apply).toHaveBeenCalledTimes(1);
  expect(field.value).toBe('5');
  expect(field.getAttribute('aria-invalid')).toBe('true');
  expect(host.querySelector('[aria-label*="자동"]')).toBeNull();
});

it('connects real App playback buttons, explicit source application, lock and reset', async () => {
  saveLocal(rcSessionDocument(10));
  await act(async () => root.render(createElement(App)));
  await click('분석하기');
  expect(host.textContent).toContain('평형 · 충분한 시간이 지난 상태');
  expect(button('등가저항').disabled).toBe(true);
  input(host.querySelector<HTMLInputElement>('.parameter-control input:not([type=range])')!, '7');
  await click('분석 진입 상태로 다시 시작');
  expect(
    host.querySelector<HTMLInputElement>('.parameter-control input:not([type=range])')!.value,
  ).toBe('10');
  const control = host.querySelector<HTMLFieldSetElement>('.parameter-control')!;
  const field = control.querySelector<HTMLInputElement>('input:not([type=range])')!;
  input(field, '5');
  await act(async () => control.querySelector<HTMLButtonElement>('button')!.click());
  expect(button('일시정지')).toBeDefined();
  expect(control.disabled).toBe(true);
  expect(button('최종 평형으로 넘기기')).toBeDefined();
  now = 1000;
  await click('일시정지');
  expect(button('재개')).toBeDefined();
  await click('최종 평형으로 넘기기');
  expect(host.textContent).toContain('평형으로 전환 중');
  now = 1200;
  act(() => {
    const pending = [...frames];
    frames.clear();
    for (const [, run] of pending) run(now);
  });
  expect(host.textContent).toContain('평형 · 충분한 시간이 지난 상태');
  await click('분석 진입 상태로 다시 시작');
  expect(
    host.querySelector<HTMLInputElement>('.parameter-control input:not([type=range])')!.value,
  ).toBe('10');
  act(() => vi.advanceTimersByTime(500));
  const saved = loadLocal();
  expect(saved?.ok && saved.document.components[0].properties.voltageV).toEqual(q.store(10));
});


it('uses keyboard probes at a paused physical time and persists finite/equilibrium records', async () => {
  saveLocal(rcSessionDocument());
  await act(async () => root.render(createElement(App)));
  await click('분석하기');
  await click('전압 탐침');
  for (const id of ['C.a', 'C.b']) act(() => host.querySelector(`[data-endpoint-id="${id}"]`)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(button('측정값 기록').disabled).toBe(true);
  now = 1000;
  await click('일시정지');
  expect(button('측정값 기록').disabled).toBe(false);
  expect(host.querySelector('.measure-reading')?.textContent ?? host.textContent).toContain('6.32');
  await click('측정값 기록');
  let entries = loadMeasurementNotebook().entries;
  expect(entries).toHaveLength(1);
  expect(entries[0].record.transient?.time).toEqual({kind:'finite', seconds:1});
  expect(entries[0].record.quality).toBe('approximate');
  expect(entries[0].record.provenance).toBeUndefined();
  await click('최종 평형으로 넘기기');
  expect(button('측정값 기록').disabled).toBe(true);
  now = 1200;
  act(() => { const pending = [...frames]; frames.clear(); for (const [, run] of pending) run(now); });
  await click('측정값 기록');
  entries = loadMeasurementNotebook().entries;
  expect(entries).toHaveLength(2);
  expect(entries[1].record.transient?.time).toEqual({kind:'equilibrium'});
  expect(entries[1].record.quality).toBe('exact');
  expect(q.equal(entries[1].record.value!,10)).toBe(true);
  expect(host.querySelector('[aria-label="측정표"]')!.textContent).toContain('최종 평형');
});

it('edits exact C and signed initial voltage together and rejects nonpositive C without changing saved state', async () => {
  saveLocal(rcSessionDocument());
  await act(async () => root.render(createElement(App)));
  act(() => host.querySelector('[data-component-id="C"] .component')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
  const c = host.querySelector<HTMLInputElement>('[aria-label="C 전기용량"]')!;
  const v = host.querySelector<HTMLInputElement>('[aria-label="C 초기 전압"]')!;
  expect(c).not.toBeNull();
  input(c,'0'); input(v,'-2/3');
  await act(async () => c.closest('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(host.textContent).toContain('전기용량은 0보다 커야');
  input(c,'200 µF');
  await act(async () => c.closest('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  act(() => vi.advanceTimersByTime(500));
  const saved = loadLocal();
  expect(saved?.ok).toBe(true);
  if (!saved?.ok) return;
  const capacitor = saved.document.components.find(c=>c.type==='capacitor')!;
  expect(capacitor.properties.capacitanceF).toEqual(q.store(q.rational(1n,5000n)));
  expect(capacitor.properties.initialVoltageV).toEqual(q.store(q.rational(-2n,3n)));
  expect(host.textContent).toContain('왼쪽 단자 전위');
  expect(host.textContent).toContain('오른쪽 단자 전위');
});


it('routes RC canvas value editing to explicit application, and capacitor editing to its initial-condition form', async () => {
  saveLocal(rcSessionDocument(10));
  await act(async () => root.render(createElement(App)));
  act(() => host.querySelector('[data-value-id="C"]')!.dispatchEvent(new MouseEvent('click',{bubbles:true})));
  expect(host.querySelector('[aria-label="C 초기 전압"]')).not.toBeNull();
  await click('분석하기');
  act(() => host.querySelector('[data-value-id="R"]')!.dispatchEvent(new MouseEvent('click',{bubbles:true})));
  const field=host.querySelector<HTMLInputElement>('[aria-label="R 값"]')!;
  input(field,'20k');
  act(() => field.dispatchEvent(new FocusEvent('focusout',{bubbles:true})));
  act(() => vi.advanceTimersByTime(500));
  let saved=loadLocal();
  expect(saved?.ok && q.equal(saved.document.components.find(c=>c.id==='R')!.properties.resistanceOhm as q.Scalar,10000)).toBe(true);
  await act(async () => field.closest('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  act(() => vi.advanceTimersByTime(500));
  saved=loadLocal();
  expect(saved?.ok && q.equal(saved.document.components.find(c=>c.id==='R')!.properties.resistanceOhm as q.Scalar,20000)).toBe(true);
});
