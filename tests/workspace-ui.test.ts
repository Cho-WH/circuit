// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { FileMenu } from '../src/app/FileMenu';
import { loadLocal, saveLocal } from '../src/persistence';
import { layoutExample } from '../src/app/examples';
import { examples } from '../src/fixtures';
import { createHistory, executeCommand, undo } from '../src/editor';

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const button = (label: string) => [...document.body.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label || b.textContent?.trim() === label)!;
const click = async (label: string) => { await act(async () => button(label).click()); };

describe('workspace transitions and file actions', () => {
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
    const doc=layoutExample(examples[1].document);doc.components.find(c=>c.id==='R1')!.properties.resistanceOhm=90000;
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
    expect(input.value).toBe('1e-8');
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
    await click('전위 보기');
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

