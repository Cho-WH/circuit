// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDocument } from '../src/domain';
import { createComponent } from '../src/component-library';
import { loadLocal, saveLocal } from '../src/persistence';
import { useCircuitSession, type WorkspaceMode } from '../src/app/useCircuitSession';

let host: HTMLDivElement;
let root: Root;
let session: ReturnType<typeof useCircuitSession>;

function Harness({ mode }: { mode: WorkspaceMode }) {
  session = useCircuitSession(mode);
  return null;
}
const render = (mode: WorkspaceMode = 'build') =>
  act(() => root.render(createElement(Harness, { mode })));

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  saveLocal(emptyDocument('session-test'));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('committed circuit session', () => {
  it('keeps consecutive edits in one event and undoes a batch as one step', () => {
    render();
    act(() => {
      session.execute({
        type: 'AddComponent',
        component: createComponent('resistor', 'R1', { x: 100, y: 100 }),
      });
      session.execute([
        { type: 'SetLabel', id: 'R1', label: '부하' },
        { type: 'SetProperties', id: 'R1', properties: { resistanceOhm: 25 } },
      ]);
    });
    const updated = session.history.present;
    expect(updated.components[0]).toMatchObject({
      label: '부하',
      properties: { resistanceOhm: 25 },
    });
    expect(session.history.past).toHaveLength(2);
    act(() => session.undo());
    expect(session.history.present.components[0]).toMatchObject({
      label: 'R1',
      properties: { resistanceOhm: 10 },
    });
    act(() => session.redo());
    expect(session.history.present).toEqual(updated);
  });

  it('leaves the document and history untouched when an activity rejects part of a batch', () => {
    const document = emptyDocument('restricted');
    document.components = [createComponent('resistor', 'R1', { x: 100, y: 100 })];
    document.activity = { allowedCommands: ['SetLabel'], revealSteps: [] };
    saveLocal(document);
    render();
    const before = session.history;
    act(() => {
      expect(
        session.execute([
          { type: 'SetLabel', id: 'R1', label: '변경' },
          { type: 'SetProperties', id: 'R1', properties: { resistanceOhm: 25 } },
        ]).ok,
      ).toBe(false);
    });
    expect(session.history).toBe(before);
  });

  it.each([true, false])(
    'keeps source placement in one undo step when reference permission is %s',
    (allowReference) => {
      const document = emptyDocument('source');
      document.activity = {
        allowedCommands: allowReference ? ['AddComponent', 'SetReference'] : ['AddComponent'],
        revealSteps: [],
      };
      saveLocal(document);
      render();
      act(() => {
        expect(
          session.placeComponent(createComponent('dc-voltage-source', 'V1', { x: 100, y: 100 })).ok,
        ).toBe(true);
      });
      expect(session.history.present.components).toHaveLength(1);
      expect(session.history.present.referenceNode).toEqual(
        allowReference ? { kind: 'terminal', id: 'V1.b' } : null,
      );
      expect(session.history.past).toHaveLength(1);
      act(() => session.undo());
      expect(session.history.present).toEqual(document);
    },
  );

  it('checks worksheet restrictions for every command before publishing a batch', () => {
    const document = emptyDocument('worksheet');
    document.components = [createComponent('resistor', 'R1', { x: 100, y: 100 })];
    saveLocal(document);
    render('worksheet');
    const before = session.history;
    act(() => {
      expect(
        session.execute([
          { type: 'SetOutputScale', scale: 1.5 },
          { type: 'SetProperties', id: 'R1', properties: { resistanceOhm: 25 } },
        ]).ok,
      ).toBe(false);
      expect(session.execute({ type: 'DeleteElements', ids: ['R1'] }).ok).toBe(false);
    });
    expect(session.history).toBe(before);
    act(() => {
      expect(session.execute({ type: 'SetOutputScale', scale: 1.5 }).ok).toBe(true);
    });
    expect(session.history.present.output?.fontScale).toBe(1.5);
  });

  it('renames the actual component in output mode, permits masks and blocks value overrides', () => {
    const doc = emptyDocument('output-name');
    doc.components = [createComponent('resistor', 'R1', { x: 100, y: 100 })];
    saveLocal(doc); render('worksheet');
    act(() => { expect(session.execute({ type: 'SetLabel', id: 'R1', label: 'R_load' }).ok).toBe(true); });
    expect(session.history.present.components[0].label).toBe('R_load');
    act(() => session.undo()); expect(session.history.present.components[0].label).toBe('R1');
    act(() => session.redo()); expect(session.history.present.components[0].label).toBe('R_load');
    const before = session.history;
    act(() => {
      const blocked: Record<string, string | number | boolean>[] = [{ resistanceOhm: 50 }, { answerText: '50 Ω' }, { labelText: 'Alias' }, { answerDisplay: 'custom' }];
      for (const properties of blocked) {
        expect(session.execute({ type: 'SetProperties', id: 'R1', properties }).ok).toBe(false);
      }
    });
    expect(session.history).toBe(before);
    act(() => { expect(session.execute({ type: 'SetProperties', id: 'R1', properties: { answerBlank: true, labelVisible: false, answerOffsetX: 20 } }).ok).toBe(true); });
    expect(session.history.present.components[0].properties.resistanceOhm).toBe(10);
    act(() => vi.advanceTimersByTime(450));
    const saved = loadLocal(); expect(saved?.ok && saved.document.components[0].label).toBe('R_load');
    render('build'); expect(session.history.present.components[0].label).toBe('R_load');
  });

  it('blocks editing and undo in measurement mode while allowing document replacement', () => {
    render();
    act(() =>
      session.execute({
        type: 'AddComponent',
        component: createComponent('resistor', 'R1', { x: 100, y: 100 }),
      }),
    );
    render('measure');
    const before = session.history;
    act(() => {
      expect(session.execute({ type: 'SetLabel', id: 'R1', label: '변경' }).ok).toBe(false);
      session.undo();
    });
    expect(session.history).toBe(before);
    act(() => {
      expect(
        session.execute({ type: 'ReplaceDocument', document: emptyDocument('replacement') }).ok,
      ).toBe(true);
    });
    expect(session.history.present.documentId).toBe('replacement');
  });

  it('debounces autosave, preserves the manual copy, and cancels pending saves on unmount', () => {
    const manual = emptyDocument('manual');
    saveLocal(manual, 'manual');
    render();
    act(() => {
      session.execute({
        type: 'AddComponent',
        component: createComponent('resistor', 'R1', { x: 100, y: 100 }),
      });
    });
    act(() => vi.advanceTimersByTime(449));
    expect(loadLocal()).toMatchObject({ ok: true, document: { components: [] } });
    act(() => vi.advanceTimersByTime(1));
    expect(loadLocal()).toMatchObject({ ok: true, document: session.history.present });
    expect(loadLocal('manual')).toMatchObject({ ok: true, document: manual });
    expect(session.saveStatus).toBe('saved');
    act(() => session.execute({ type: 'SetLabel', id: 'R1', label: '저장 전' }));
    act(() => root.render(null));
    act(() => vi.advanceTimersByTime(450));
    const restored = loadLocal();
    expect(restored?.ok && restored.document.components[0].label).toBe('R1');
  });
});
