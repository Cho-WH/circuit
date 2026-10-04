import * as q from '../src/rational';
// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { QUICK_START_SEEN_KEY } from '../src/app/useQuickStart';
import { compactLayoutQuery } from '../src/app/useCompactLayout';
import { FileMenu } from '../src/app/FileMenu';
import { loadLocal, saveLocal } from '../src/persistence';
import { layoutExample } from '../src/app/examples';
import { examples } from '../src/fixtures';
import { createHistory, executeCommand, undo } from '../src/editor';
import { requireDocument } from '../src/domain';
import shortCircuit from '../fixtures/FIX-06-source-short.json';

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  localStorage.setItem(QUICK_START_SEEN_KEY, 'true');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const button = (label: string) => [...document.body.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label || b.textContent?.trim() === label)!;
const click = async (label: string) => { await act(async () => button(label).click()); };

describe('compact workspace', () => {
  beforeEach(() => {
    const matchMedia = window.matchMedia.bind(window);
    vi.spyOn(window, 'matchMedia').mockImplementation(query => {
      const media = matchMedia(query);
      if (query === compactLayoutQuery) Object.defineProperty(media, 'matches', { value: true });
      return media;
    });
  });
  it('switches the shared bar without losing view options, probes, readings or records', async () => {
    const doc = layoutExample(examples[1].document);
    saveLocal(doc);
    await act(async () => root.render(createElement(App)));
    await click('분석하기');
    const numbers = () => [...host.querySelectorAll('[data-endpoint-id] title')].map(node => node.textContent);
    const initialNumbers = numbers();
    expect(initialNumbers).toContain('9 V');
    await click('전위');
    expect(numbers()).toEqual(initialNumbers);
    await click('전류');
    const canvas = host.querySelector('.circuit-canvas')!;
    const view = canvas.getAttribute('viewBox');
    await click('측정');
    expect(document.activeElement).toBe(button('보기 도구로 돌아가기'));
    for (const label of ['R_1 · 왼쪽 단자', 'R_1 · 오른쪽 단자']) {
      await act(async () => host.querySelector(`[aria-label="${label}"]`)!.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true})));
    }
    expect(host.querySelector('output[aria-label="측정값"]')?.textContent).toBe('3 V');
    expect(button('빨강 탐침 전위 9 V')).toBeDefined();
    expect(button('검정 탐침 전위 6 V')).toBeDefined();
    await click('측정 더보기'); await click('측정값 기록');
    await click('보기 도구로 돌아가기');
    expect(document.activeElement).toBe(button('측정'));
    expect(button('전위').getAttribute('aria-pressed')).toBe('false');
    expect(button('전류').getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('.circuit-canvas')).toBe(canvas);
    expect(canvas.getAttribute('viewBox')).toBe(view);
    await click('측정');
    expect(host.querySelector('output[aria-label="측정값"]')?.textContent).toBe('3 V');
    await click('측정 더보기'); await click('기록 보기 1');
    expect(host.querySelector('.measure-notebook')?.textContent).toContain('3 V');
    expect(loadLocal()).toEqual({ok:true,document:doc});
  });
  it('restores normal visualization after isolated resistance measurement', async () => {
    saveLocal(layoutExample(examples[1].document));
    await act(async () => root.render(createElement(App)));
    await click('분석하기'); await click('측정'); await click('전압'); await click('등가저항');
    expect(button('전지 분리하고 측정')).toBeDefined();
    expect(host.querySelector('.measurement-surface')).toBeNull();
    await click('전지 분리하고 측정');
    expect(host.querySelector('.measurement-surface')).not.toBeNull();
    await click('보기 도구로 돌아가기');
    expect(button('전위').getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('.measurement-surface')).toBeNull();
    expect(button('3D').disabled).toBe(false);
    expect(host.querySelector('[data-value-id="R1"]')?.getAttribute('role')).toBe('button');
  });
  it('folds parts and output editing while keeping variable resistor controls reachable', async () => {
    const doc = layoutExample(examples[1].document);
    doc.components.find(c => c.id === 'R1')!.type = 'resistive-load';
    saveLocal(doc);
    await act(async () => root.render(createElement(App)));
    expect(host.querySelector('.library-panel .component-grid')).toBeNull();
    await click('부품 추가');
    expect(document.querySelector('.compact-parts-panel .component-tile')?.getAttribute('draggable')).toBe('false');
    await click('저항');
    expect(document.querySelector('.compact-parts-panel')).toBeNull();
    await click('분석하기');
    await act(async () => host.querySelector('[data-component-id="R1"] .component')!
      .dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true})));
    expect(host.querySelector('.parameter-open .parameter-panel:not([hidden]) .parameter-slider')).not.toBeNull();
    await click('가변저항 조절 닫기');
    expect(host.querySelector('.parameter-open')).toBeNull();
    expect(button('사용 도움말').closest('.top-actions')).not.toBeNull();
    expect(button('사용 후기 및 피드백').textContent).toBe('');
    await click('파일'); await click('회로도 출력');
    expect(host.querySelector('[aria-label="회로도 출력 보기"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="글자 크기 배율"]')).toBeNull();
    expect(host.querySelector('.output-canvas [role="button"]')).toBeNull();
    expect(button('그림 복사')).toBeDefined();
  });
  it('opens the shared palette picker on demand inside the compact more menu', async () => {
    saveLocal(layoutExample(examples[1].document));
    await act(async () => root.render(createElement(App)));
    await click('분석하기');
    const colors = () => [...host.querySelectorAll('.wire-ink')].map(node => node.getAttribute('stroke'));
    const before = colors();
    await click('보기 더보기');
    const menu = document.querySelector('[role="menu"][aria-label="보기 더보기"]')!;
    expect(menu.querySelector('[role="menuitemcheckbox"]')).toBeNull();
    expect(document.querySelector('[role="menuitemradio"]')).toBeNull();
    const picker = () => menu.querySelector<HTMLButtonElement>('.potential-palette-trigger')!;
    await act(async () => picker().click());
    expect(menu.isConnected).toBe(true);
    expect(document.querySelectorAll('[role="menuitemradio"]')).toHaveLength(3);
    await act(async () => button('전체 스펙트럼').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true})));
    expect(document.activeElement).toBe(button('파랑 → 노랑'));
    await act(async () => button('파랑 → 노랑').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch'})));
    await click('파랑 → 노랑');
    expect(menu.isConnected).toBe(true);
    expect(document.querySelector('[role="menuitemradio"]')).toBeNull();
    expect(picker().getAttribute('aria-label')).toContain('파랑 → 노랑');
    expect(document.activeElement).toBe(picker());
    expect(colors()).not.toEqual(before);
    await act(async () => picker().click());
    await act(async () => button('파랑 → 노랑').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    expect(menu.isConnected).toBe(true);
    expect(document.activeElement).toBe(picker());
    await act(async () => picker().dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    expect(document.activeElement).toBe(button('보기 더보기'));
    expect(menu.isConnected).toBe(false);
  });
});

describe('workspace transitions and file actions', () => {
  it('opens assembly diagnostics on demand, locates grouped terminals and removes the icon after repair', async () => {
    const doc = layoutExample(examples[0].document);
    saveLocal(doc);
    await act(async () => root.render(createElement(App)));
    expect(button('조립 안내')).toBeUndefined();
    const wire = doc.wires[0];
    await act(async () => host.querySelector(`[data-wire-id="${wire.id}"]`)!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await act(async () => host.querySelector('.circuit-canvas')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })));
    const trigger = button('조립 안내');
    const view = host.querySelector('.circuit-canvas')!.getAttribute('viewBox');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.closest('.is-warning')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await click('조립 안내');
    const panel = document.querySelector('[role="dialog"][aria-label="조립 안내"]')!;
    expect(document.activeElement).toBe(panel);
    expect(panel.textContent).toContain('단자 2곳을 연결할 수 있습니다');
    expect(host.querySelector('.circuit-canvas')!.getAttribute('viewBox')).toBe(view);
    await act(async () => panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.activeElement).toBe(trigger);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await click('조립 안내');
    await act(async () => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await click('조립 안내');
    await click('회로에서 위치 보기');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect([...host.querySelectorAll('[data-component-id][data-selected="true"]')].map(e => e.getAttribute('data-component-id')))
      .toEqual(doc.components.filter(c => c.terminals.some(t => t.id === wire.start.id || t.id === wire.end.id)).map(c => c.id));
    await click('실행 취소');
    expect(button('조립 안내')).toBeUndefined();
    await click('다시 실행');
    expect(button('조립 안내').getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps error diagnostics collapsed and reachable in every workspace', async () => {
    saveLocal(layoutExample(requireDocument(shortCircuit.document)));
    await act(async () => root.render(createElement(App)));
    for (const mode of ['회로 만들기', '분석하기', '회로도 출력']) {
      await click(mode);
      const trigger = button('회로 연결 확인');
      expect(trigger.closest('.is-warning')).not.toBeNull();
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      await click('회로 연결 확인');
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain('전원이 단락되어 있어요');
      await click('안내 닫기');
      expect(document.activeElement).toBe(trigger);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    }
  });

  it.each(['label', 'value'])('moves the first output %s drag without opening settings, and opens them on click', async (part) => {
    const matchMedia = window.matchMedia.bind(window);
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
      const media = matchMedia(query);
      if (query === '(min-width: 641px)') Object.defineProperty(media, 'matches', { value: true });
      return media;
    });
    vi.stubGlobal('DOMPoint', class {
      constructor(public x: number, public y: number) {}
      matrixTransform() { return this; }
    });
    saveLocal(layoutExample(examples[1].document));
    await act(async () => root.render(createElement(App)));
    await click('회로도 출력');
    const svg = host.querySelector<SVGSVGElement>('.output-canvas')!;
    Object.assign(svg, { getScreenCTM: () => ({ a: 1, inverse: () => ({}) }), setPointerCapture: () => {} });
    const target = () => host.querySelector(`[data-output-id="R1"][data-output-part="${part}"]`)!;
    const pointer = async (element: Element, type: string, x: number, y: number) => {
      await act(async () => element.dispatchEvent(new PointerEvent(type, {
        bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y,
      })));
    };
    const before = target().innerHTML;
    const view = svg.getAttribute('viewBox');
    await pointer(target(), 'pointerdown', 400, 200);
    expect(button('표시 설정').getAttribute('aria-expanded')).toBe('false');
    await pointer(svg, 'pointermove', 450, 170);
    expect(target().innerHTML).not.toBe(before);
    await pointer(svg, 'pointerup', 450, 170);
    expect(button('표시 설정').getAttribute('aria-expanded')).toBe('false');
    expect(svg.getAttribute('viewBox')).toBe(view);
    await click('출력 실행 취소');
    expect(target().innerHTML).toBe(before);
    expect(button('출력 실행 취소').disabled).toBe(true);
    await pointer(target(), 'pointerdown', 400, 200);
    await pointer(svg, 'pointermove', 450, 170);
    await pointer(svg, 'pointercancel', 450, 170);
    await pointer(svg, 'pointerup', 450, 170);
    expect(target().innerHTML).toBe(before);
    expect(button('표시 설정').getAttribute('aria-expanded')).toBe('false');
    await pointer(target(), 'pointerdown', 400, 200);
    await pointer(svg, 'pointerup', 400, 200);
    expect(button('표시 설정').getAttribute('aria-expanded')).toBe('true');
  });

  it.each(['회로도 출력', '분석하기'])('starts a new blank circuit in the build workspace from %s', async (mode) => {
    const original = layoutExample(examples[1].document);
    saveLocal(original);
    await act(async () => root.render(createElement(App)));
    await click(mode);
    await click(mode === '회로도 출력' ? '표시 설정' : '상세 설정');
    await click('수업 화면');
    await click('파일');
    await click('새 회로');
    expect(button('회로 만들기').getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('.app-shell')?.classList.contains('presentation')).toBe(false);
    expect(host.querySelector<HTMLElement>('.library-panel')?.hidden).toBe(false);
    expect(host.querySelector<HTMLElement>('.inspector-panel')?.hidden).toBe(true);
    expect(host.querySelectorAll('[data-component-id]')).toHaveLength(0);
    expect(button('저항')).toBeDefined();
    await click('실행 취소');
    expect(host.querySelector<HTMLInputElement>('.document-heading input')?.value).toBe(original.title);
  });

  it('keeps the output mode when restoring a saved circuit', async () => {
    const stored = layoutExample(examples[1].document);
    saveLocal(stored, 'manual');
    saveLocal({ ...stored, title: '복원 전 회로' });
    await act(async () => root.render(createElement(App)));
    await click('회로도 출력');
    await click('파일');
    await click('보관한 회로 불러오기');
    expect(button('회로도 출력').getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector<HTMLInputElement>('.document-heading input')?.value).toBe(stored.title);
  });

  it('reads the selected wire current in potential view by mouse and keyboard',async()=>{
    saveLocal(layoutExample(examples.find(e=>e.id==='FIX-03')!.document));
    await act(async()=>root.render(createElement(App)));await click('분석하기');
    const toggle=[...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(input=>input.parentElement?.textContent?.trim()==='전류 흐름')!;
    await act(async()=>toggle.click());
    expect(host.querySelector('.potential-workspace > .current-pause')).not.toBeNull();
    expect([...host.querySelectorAll('.wire-ink')].every(el=>el.getAttribute('visibility')==='hidden')).toBe(true);
    await click('상세 설정');
    expect(host.querySelector('[aria-label="전류 두께 배율"]')).not.toBeNull();
    for(const [id,value,key] of [['W1','3 A',false],['W2','1 A',true],['W3','2 A',true]] as const) {
      const wire = host.querySelector(`[data-wire-id="${id}"]`)!;
      await act(async()=>wire.dispatchEvent(key?new KeyboardEvent('keydown',{key:'Enter',bubbles:true}):new MouseEvent('click',{bubbles:true})));
      expect(host.querySelector('.current-readout strong .notation')?.getAttribute('aria-label')).toBe(wire.getAttribute('aria-label'));
      expect(host.querySelector('.current-readout')?.textContent).toContain(value);
    }
    expect(button('3D').disabled).toBe(false);
    await act(async()=>host.querySelector('[data-endpoint-id="JT"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
    expect(host.querySelector('.current-readout')?.textContent).toContain('도선이나 부품을 선택');
    await click('흐름 일시 정지');expect(button('흐름 재생')).toBeDefined();
  });
  it('selects renamed examples through the shared menu and supports undo',async()=>{
    const original=layoutExample(examples[1].document);saveLocal(original);
    await act(async()=>root.render(createElement(App)));
    await click('예제 회로');
    const menu=document.querySelector('[aria-label="예제 회로 목록"]')!;
    expect(host.querySelector('.library-panel')!.contains(menu)).toBe(false);
    expect(menu.querySelector('[aria-checked="true"]')?.textContent).toBe(examples[1].title);
    expect(button('저항 사이 접지')).toBeDefined();
    await click('휘트스톤 브릿지');
    expect(document.querySelector('[aria-label="예제 회로 목록"]')).toBeNull();
    expect(host.querySelector<HTMLInputElement>('.document-heading input')?.value).toBe('휘트스톤 브릿지');
    await click('실행 취소');
    expect(host.querySelector<HTMLInputElement>('.document-heading input')?.value).toBe(original.title);
    await click('다시 실행');
    expect(host.querySelector<HTMLInputElement>('.document-heading input')?.value).toBe('휘트스톤 브릿지');
  });

  it('shares keyboard dismissal, outside clicks and viewport dismissal across both menus',async()=>{
    await act(async()=>root.render(createElement(App)));
    for(const label of ['예제 회로','파일']){
      await click(label);
      const menu=document.querySelector('[role="menu"]')!;
      const items=menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
      expect(document.activeElement).toBe(items[0]);
      await act(async()=>items[0].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})));
      expect(document.activeElement).toBe(items[1]);
      await act(async()=>items[1].dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
      expect(document.querySelector('[role="menu"]')).toBeNull();
      expect(document.activeElement).toBe(button(label));
      await click(label);
      await act(async()=>window.dispatchEvent(new Event('resize')));
      expect(document.querySelector('[role="menu"]')).toBeNull();
      await click(label);
      await act(async()=>document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})));
      expect(document.querySelector('[role="menu"]')).toBeNull();
    }
  });

  it('edits the variable resistor range in build and reuses its saved limits in analysis', async () => {
    const doc = layoutExample(examples.find(e => e.id === 'FIX-02')!.document);
    const variable = doc.components.find(c => c.id === 'R1')!;
    variable.type = 'resistive-load';
    variable.properties = { resistanceOhm: q.store(3), resistanceMinOhm: q.store(1), resistanceMaxOhm: q.store(10) };
    saveLocal(doc);
    await act(async () => root.render(createElement(App)));
    await act(async () => host.querySelector('[data-component-id="R1"] .component')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    const input = (selector: string) => host.querySelector<HTMLInputElement>(selector)!;
    async function fill(selector: string, value: string) {
      await act(async () => {
        const element = input(selector);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    await click('이름·값');
    expect(input('#inline-component-value').value).toBe('3');
    await fill('.inline-value-editor [aria-label="저항값 최솟값"]', '5');
    await fill('.inline-value-editor [aria-label="저항값 최댓값"]', '2');
    await click('적용');
    expect(host.querySelector('.inline-value-editor [role="alert"]')).not.toBeNull();
    await click('취소');
    await click('이름·값');
    expect(input('.inline-value-editor [aria-label="저항값 최솟값"]').value).toBe('1');
    await fill('#inline-component-name', '조절 저항');
    await fill('.inline-value-editor [aria-label="저항값 최솟값"]', '5');
    await fill('.inline-value-editor [aria-label="저항값 최댓값"]', '2k');
    await fill('#inline-component-value', '3000');
    await click('적용');
    expect(host.querySelector('.inline-value-editor [role="alert"]')?.textContent).toContain('범위');
    await fill('#inline-component-value', '15');
    await click('적용');
    expect(host.querySelector('[data-value-id="R1"]')?.textContent).toBe('15 Ω');
    await click('실행 취소');
    expect(host.querySelector('[data-component-id="R1"] .component')?.getAttribute('aria-label')).toBe(variable.label + ' 3 Ω');
    await click('다시 실행');
    await click('상세 설정');
    expect(input('.inspector-panel input[aria-label="조절 저항 값"]').value).toBe('15');
    await fill('.inspector-panel input[aria-label="조절 저항 값"]', '12');
    await act(async () => input('.inspector-panel input[aria-label="조절 저항 값"]')
      .closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(input('.inspector-panel [aria-label="저항값 최댓값"]').value).toBe('2000');
    await fill('.inspector-panel [aria-label="저항값 최댓값"]', '20');
    await act(async () => input('.inspector-panel [aria-label="저항값 최댓값"]')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await click('분석하기');
    const slider = input('.parameter-slider');
    expect(slider.getAttribute('aria-valuemin')).toBe('5');
    expect(slider.getAttribute('aria-valuemax')).toBe('20');
    expect(slider.getAttribute('aria-valuenow')).toBe('12');
    expect(host.querySelector('[data-value-id="R1"]')?.textContent).toBe('12 Ω');
    await fill('.parameter-slider', '1000');
    await act(async () => slider.dispatchEvent(new Event('pointerup', { bubbles: true })));
    expect(slider.getAttribute('aria-valuenow')).toBe('20');
    expect(host.querySelector('[data-value-id="R1"]')?.textContent).toBe('20 Ω');
  });

  it('toggles a switch immediately while preserving the name draft and independent undo',async()=>{
    const doc=layoutExample(examples.find(e=>e.document.components.some(c=>c.type==='switch'))!.document);
    const item=doc.components.find(c=>c.type==='switch')!;item.properties.state='open';saveLocal(doc);
    await act(async()=>root.render(createElement(App)));
    await act(async()=>host.querySelector('[data-component-id="'+item.id+'"] .component')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
    await click('이름·값');
    const form=host.querySelector('.inline-value-editor')!;
    expect(form.querySelector('.switch-state-toggle')?.textContent).toBe('스위치 닫기');
    await act(async()=>form.querySelector<HTMLButtonElement>('.switch-state-toggle')!.click());
    const input=form.querySelector<HTMLInputElement>('#inline-component-name')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'주 스위치');input.dispatchEvent(new Event('input',{bubbles:true}));});
    expect(host.querySelector('[data-value-id="'+item.id+'"]')?.textContent).toBe('닫힘');
    await act(async()=>form.querySelector<HTMLButtonElement>('.switch-state-toggle')!.click());
    expect(input.value).toBe('주 스위치');
    expect(host.querySelector('[data-value-id="'+item.id+'"]')?.textContent).toBe('열림');
    await act(async()=>form.querySelector<HTMLButtonElement>('.switch-state-toggle')!.click());
    await click('적용');
    expect(host.querySelector('.inline-value-editor')).toBeNull();
    expect(host.querySelector('[data-value-id="'+item.id+'"]')?.textContent).toBe('닫힘');
    expect(host.querySelector('[data-component-id="'+item.id+'"]')?.textContent).toContain('주 스위치');
    await click('실행 취소');
    expect(host.querySelector('[data-value-id="'+item.id+'"]')?.textContent).toBe('닫힘');
    expect(host.querySelector('[data-component-id="'+item.id+'"] .component')?.getAttribute('aria-label')).toBe(item.label+' 닫힘');
    await click('실행 취소');
    expect(host.querySelector('[data-value-id="'+item.id+'"]')?.textContent).toBe('열림');
    expect(host.querySelector('[data-component-id="'+item.id+'"] .component')?.getAttribute('aria-label')).toBe(item.label+' 열림');
    await click('다시 실행');expect(host.querySelector('[data-value-id="'+item.id+'"]')?.textContent).toBe('닫힘');
    await click('이름·값');expect(host.querySelector('.inline-value-editor .switch-state-toggle')?.textContent).toBe('스위치 열기');
    await act(async()=>host.querySelector<HTMLButtonElement>('.inline-value-editor .switch-state-toggle')!.click());await click('취소');
    expect(host.querySelector('[data-value-id="'+item.id+'"]')?.textContent).toBe('열림');
  });

  it('rejects an immediate switch state change when the activity only permits renaming',async()=>{
    const doc=layoutExample(examples.find(e=>e.document.components.some(c=>c.type==='switch'))!.document);
    const item=doc.components.find(c=>c.type==='switch')!;item.properties.state='open';doc.activity={allowedCommands:['SetLabel'],revealSteps:[]};saveLocal(doc);
    await act(async()=>root.render(createElement(App)));
    await act(async()=>host.querySelector('[data-component-id="'+item.id+'"] .component')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));await click('이름·값');
    const input=host.querySelector<HTMLInputElement>('#inline-component-name')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'차단된 변경');input.dispatchEvent(new Event('input',{bubbles:true}));});
    await act(async()=>host.querySelector<HTMLButtonElement>('.inline-value-editor .switch-state-toggle')!.click());
    expect(host.querySelector('.inline-value-editor [role="alert"]')?.textContent).toContain('바꿀 수 없습니다');
    expect(host.querySelector('[data-component-id="'+item.id+'"] .component')?.getAttribute('aria-label')).toBe(item.label+' 열림');
  });

  it('stores display modes per component and applies the chosen mode to all in one undo step',async()=>{
    const doc=layoutExample(examples[1].document);doc.components.find(c=>c.id==='R1')!.properties.resistanceOhm=q.store(90000);
    saveLocal(doc);await act(async()=>root.render(createElement(App)));
    expect(host.querySelector('.topbar [aria-label="숫자 표시 방식"]')).toBeNull();
    await act(async()=>host.querySelector('[data-component-id="R1"] .component')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
    expect(button('값 적용')).toBeUndefined();
    for(const [label,text] of [['자동 단위','90 kΩ'],['유효 숫자','9.000 × 10⁴ Ω'],['원래 숫자','90000 Ω']]){
      await click('숫자 표시 방식');await click(label);
      expect(host.querySelector('[data-value-id="R1"]')?.textContent).toBe(text);
      expect(host.querySelector('[data-value-id="R2"]')?.textContent).toBe('6 Ω');
      await click('회로도 출력');
      expect(host.querySelector('[data-output-id="R1"][data-output-part="value"]')?.textContent).toContain(text);
      await click('회로 만들기');
    }
    await click('숫자 표시 방식');await click('유효 숫자');await click('전체 적용');
    expect(host.querySelector('[data-value-id="R2"]')?.textContent).toBe('6.000 × 10⁰ Ω');
    await click('실행 취소');
    expect(host.querySelector('[data-value-id="R1"]')?.textContent).toBe('9.000 × 10⁴ Ω');
    expect(host.querySelector('[data-value-id="R2"]')?.textContent).toBe('6 Ω');
    await click('다시 실행');
    expect(host.querySelector('[data-value-id="R2"]')?.textContent).toBe('6.000 × 10⁰ Ω');
  });

  it('commits property values on blur or Enter and cancels an unfinished draft with Escape',async()=>{
    saveLocal(layoutExample(examples[1].document));await act(async()=>root.render(createElement(App)));
    await act(async()=>host.querySelector('[data-component-id="R1"] .component')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
    const input=host.querySelector<HTMLInputElement>('[aria-label="R_1 값"]')!;
    const change=async(value:string)=>act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});
    await change('10n');await act(async()=>input.dispatchEvent(new FocusEvent('focusout',{bubbles:true})));
    expect(host.querySelector('[data-value-id="R1"]')?.textContent).toBe('10 nΩ');
    await change('12/');await act(async()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    expect(input.value).toBe('0.00000001');
    await change('1/0');await act(async()=>input.dispatchEvent(new FocusEvent('focusout',{bubbles:true})));
    expect(host.querySelector('[data-value-id="R1"]')?.textContent).toBe('10 nΩ');
    await change('90k');await act(async()=>input.closest('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(host.querySelector('[data-value-id="R1"]')?.textContent).toBe('90 kΩ');
  });

  it('commits a whole name once and rejects empty output names',async()=>{
    saveLocal(layoutExample(examples[1].document));await act(async()=>root.render(createElement(App)));await click('회로도 출력');
    await act(async()=>host.querySelector('[data-output-id="R1"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
    const input=host.querySelector<HTMLInputElement>('input[aria-label="기호·이름"]')!;
    const change=async(value:string)=>act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});
    const commit=async()=>act(async()=>input.dispatchEvent(new FocusEvent('focusout',{bubbles:true})));
    await change('   ');await commit();expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelector('[data-output-id="R1"][data-output-part="label"]')?.getAttribute('aria-label')).toBe('R_1 이름');
    await change(' R_');await change(' R_load ');await commit();expect(input.value).toBe('R_load');
    await click('출력 실행 취소');expect(input.value).toBe('R_1');
  });

  it.each(['button', 'keyboard'])('deletes a component through %s while preserving wiring, with one undo step', async input => {
    const doc = layoutExample(examples[1].document);
    saveLocal(doc);
    await act(async () => root.render(createElement(App)));
    const paths = () => [...host.querySelectorAll('[data-wire-id]')].map(e => [e.getAttribute('data-wire-id'), e.getAttribute('points')]);
    const before = paths(), id = doc.components.find(c => c.type === 'resistor')!.id;
    await act(async () => host.querySelector(`[data-component-id="${id}"] .component`)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    if (input === 'button') await click('삭제');
    else await act(async () => host.querySelector('.circuit-canvas')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })));
    expect(host.querySelector(`[data-component-id="${id}"]`)).toBeNull();
    expect(paths()).toHaveLength(before.length - 1);
    expect([...host.querySelectorAll('[data-endpoint-kind="junction"]')].map(e => e.getAttribute('data-endpoint-id')))
      .toEqual(doc.junctions.map(j => j.id));
    for (const [wireId, points] of before.filter(([wireId]) => !doc.wires.some(w => w.id === wireId && (w.start.id.startsWith(id + '.') || w.end.id.startsWith(id + '.'))))) {
      expect(paths()).toContainEqual([wireId, points]);
    }
    const after = paths();
    await click('실행 취소');
    expect(host.querySelector(`[data-component-id="${id}"]`)).not.toBeNull();
    expect(paths()).toEqual(before);
    await click('다시 실행'); expect(paths()).toEqual(after);
  });

  it('keeps the zoomed circuit view through mode and panel changes', async () => {
    await act(async () => root.render(createElement(App)));
    await click('확대');
    const view = host.querySelector('.circuit-canvas')!.getAttribute('viewBox');
    await click('분석하기');
    expect(host.querySelector('.circuit-canvas')!.getAttribute('viewBox')).toBe(view);
    await click('상세 설정');
    expect(host.querySelector('.circuit-canvas')!.getAttribute('viewBox')).toBe(view);
    await click('회로 만들기');
    expect(host.querySelector('.circuit-canvas')!.getAttribute('viewBox')).toBe(view);
  });

  it('edits the shared component name but only masks its actual value in output', async () => {
    saveLocal(layoutExample(examples[1].document));
    await act(async () => root.render(createElement(App)));
    await click('회로도 출력');
    await act(async () => host.querySelector('[data-output-id="R1"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    const panel = host.querySelector('.worksheet-panel')!;
    expect(panel.querySelector('input[aria-label="값 출력 문자"]')).toBeNull();
    expect(panel.querySelector('output[aria-label="실제 부품 값"]')?.textContent).toBe('3 Ω');
    const input = panel.querySelector<HTMLInputElement>('input[aria-label="기호·이름"]')!;
    expect(input.value).toBe('R_1');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'R_load');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
    expect(host.querySelector('[data-output-id="R1"][data-output-part="label"]')?.getAttribute('aria-label')).toBe('R_load 이름');
    await click('출력 실행 취소'); expect(input.value).toBe('R_1');
    await click('출력 다시 실행'); expect(input.value).toBe('R_load');
    await act(async () => panel.querySelector<HTMLInputElement>('[aria-label="값 빈칸"]')!.click());
    expect(host.querySelector('[data-output-id="R1"][data-output-part="value"] rect')).not.toBeNull();
    await act(async () => panel.querySelector<HTMLInputElement>('[aria-label="값 표시"]')!.click());
    expect(host.querySelector('[data-output-id="R1"][data-output-part="value"]')).toBeNull();
    await click('회로 만들기');
    expect(host.querySelector('[data-component-id="R1"]')?.textContent).toContain('𝑙𝑜𝑎𝑑');
    expect(host.querySelector('[data-component-id="R1"]')?.textContent).toContain('3 Ω');
  });

  it('keeps output arrow value text editable', async () => {
    const doc = layoutExample(examples[1].document);
    doc.annotations = [{ id: 'arrow-text', kind: 'arrow', anchor: null, position: { x: 300, y: 300 }, content: 'I', visibility: 'always' }];
    saveLocal(doc);
    await act(async () => root.render(createElement(App)));
    await click('회로도 출력');
    await act(async () => host.querySelector('[data-output-id="arrow-text"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    const input = host.querySelector<HTMLInputElement>('.worksheet-panel input[aria-label="값 출력 문자"]')!;
    expect(input).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '2 A');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.querySelector('[data-output-id="arrow-text"][data-output-part="value"]')?.textContent).toContain('2 A');
    await click('출력 실행 취소'); expect(input.value).toBe('');
    await click('출력 다시 실행'); expect(input.value).toBe('2 A');
  });

  it('drops output-only selection when returning to circuit editing', async () => {
    const doc = layoutExample(examples[1].document);
    doc.annotations = [{ id: 'note-only', kind: 'note', anchor: null, position: { x: 200, y: 200 }, content: '메모', visibility: 'always' }];
    saveLocal(doc);
    await act(async () => root.render(createElement(App)));
    await click('회로도 출력');
    const annotation = host.querySelector('[data-output-id="note-only"]')!;
    await act(async () => {
      annotation.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(host.querySelector('.inspector-panel')?.hasAttribute('hidden')).toBe(false);
    await click('회로 만들기');
    expect(button('선택 요소 삭제')).toBeUndefined();
  });

  it('separates downloading and manual storage, and restores through undoable history', async () => {
    const doc = layoutExample(examples[1].document);
    let history = createHistory(doc);
    const onSave = vi.fn(), onNotice = vi.fn();
    const onRestore = vi.fn((restored: typeof doc) => {
      const applied = executeCommand(history, { type: 'ReplaceDocument', document: restored });
      if (applied.ok) history = applied.history;
    });
    await act(async () => root.render(createElement(FileMenu, { document: doc, onOpen: vi.fn(), onNew: vi.fn(), onSave, onNotice, onRestore })));
    await click('파일');
    expect(button('보관한 회로 불러오기').disabled).toBe(true);
    await click('회로 파일 저장');
    expect(onSave).toHaveBeenCalledOnce(); expect(loadLocal('manual')).toBeNull();
    await click('파일'); await click('현재 회로 보관');
    history = createHistory({ ...doc, title: '수정한 회로' });
    await click('보관한 회로 불러오기');
    expect(history.present.title).toBe(doc.title);
    expect(undo(history).present.title).toBe('수정한 회로');
  });

  it('keeps failed storage actionable without reporting success', async () => {
    const onNotice = vi.fn();
    await act(async () => root.render(createElement(FileMenu, { document: layoutExample(examples[1].document), onOpen: vi.fn(), onNew: vi.fn(), onSave: vi.fn(), onRestore: vi.fn(), onNotice })));
    await click('파일');
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    await click('현재 회로 보관');
    expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('회로 파일'), 'error');
    expect(button('보관했어요')).toBeUndefined();
    expect(button('보관한 회로 불러오기').disabled).toBe(true);
  });
});

