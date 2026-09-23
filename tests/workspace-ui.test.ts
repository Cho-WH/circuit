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
const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label || b.textContent?.trim() === label)!;
const click = async (label: string) => { await act(async () => button(label).click()); };

describe('workspace transitions and file actions', () => {
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

