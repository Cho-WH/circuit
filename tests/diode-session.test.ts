// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import fixture from '../fixtures/FIX-13-forward-diode.json';
import { requireDocument } from '../src/domain';
import * as q from '../src/rational';
import { saveLocal, serializeDocument } from '../src/persistence';
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

it('allows overload recovery, retains the physical model and does not replay unchanged causes',()=>{
  saveLocal(circuit());render('build');
  act(()=>session.changeWorkspace('analysis'));render('analysis');
  expect(session.analysisSession.componentModel).toBe(false);
  act(()=>change(10));expect(session.analysisSession.phase).toBe('overload');
  const event=session.analysisSession.events.D1;
  act(()=>change(9));expect(session.analysisSession.events.D1).toBe(event);
  act(()=>change(1000));expect(session.analysisSession.phase).toBe('normal');
  expect(session.analysisSession.componentModel).toBe(true);
  act(()=>change(10));expect(session.analysisSession.events.D1).toBeGreaterThan(event);
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
  await act(async()=>button('회로 수정').click());
  expect(host.querySelector('[data-operating-state]')).toBeNull();expect(button('파손 주의')).toBeTruthy();
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
  expect(presentation.value).toBe('0.7 V');
  expect(presentation.voltage).toContain('≈');expect(presentation.current).toContain('≈');
  expect(exportSvg(doc,{},evaluated.result)).toContain('≈');
});
