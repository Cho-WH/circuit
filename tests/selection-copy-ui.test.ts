// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { QUICK_START_SEEN_KEY } from '../src/app/useQuickStart';
import { compactLayoutQuery } from '../src/app/useCompactLayout';
import { emptyDocument } from '../src/domain';
import { createComponent, componentDefinitions } from '../src/component-library';
import { loadLocal, saveLocal } from '../src/persistence';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'DOMPoint',
    class {
      constructor(
        public x: number,
        public y: number,
      ) {}
      matrixTransform() {
        return this;
      }
    },
  );
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem(QUICK_START_SEEN_KEY, 'true');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});
function fixture() {
  const doc = emptyDocument('copy-ui');
  doc.components = [
    createComponent('diode', 'D', { x: 200, y: 200 }),
    createComponent('resistor', 'A', { x: 200, y: 400 }),
    createComponent('resistor', 'B', { x: 800, y: 400 }),
  ];
  doc.components[0].label = '복사할 다이오드';
  doc.junctions = [{ id: 'J', position: { x: 500, y: 400 } }];
  doc.wires = [
    {
      id: 'W1',
      start: { kind: 'terminal', id: 'A.b' },
      end: { kind: 'junction', id: 'J' },
      waypoints: [],
    },
    {
      id: 'W2',
      start: { kind: 'junction', id: 'J' },
      end: { kind: 'terminal', id: 'B.a' },
      waypoints: [],
    },
  ];
  return doc;
}
function render(doc = fixture()) {
  saveLocal(doc);
  act(() => root.render(createElement(App)));
  const svg = host.querySelector<SVGSVGElement>('.circuit-canvas')!;
  Object.assign(svg, {
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => false,
    getScreenCTM: () => ({ a: 1, inverse: () => ({}) }),
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      right: 1400,
      bottom: 1000,
      width: 1400,
      height: 1000,
    }),
  });
  return svg;
}
const button = (label: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const key = (target: Element, key: string, ctrlKey = false) =>
  act(() => target.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey, bubbles: true })));
const click = (target: Element, x = 0, y = 0) =>
  act(() =>
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y })),
  );
const pointer = (target: Element, type: string, x: number, y: number, pointerType = 'touch') =>
  act(() =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: 1,
        pointerType,
        clientX: x,
        clientY: y,
        button: 0,
      }),
    ),
  );
function saved() {
  act(() => vi.advanceTimersByTime(450));
  const result = loadLocal();
  if (!result?.ok) throw Error('save failed');
  return result.document;
}

it('allocates palette names per kind despite mixed placement, cancelled copying and undo', () => {
  const svg = render(emptyDocument('placement-names'));
  const place = (name: string, x: number) => {
    const tile = [...host.querySelectorAll<HTMLButtonElement>('.component-tile')].find(b => b.textContent === name)!;
    click(tile); pointer(svg, 'pointerdown', x, 200, 'mouse'); pointer(svg, 'pointerup', x, 200, 'mouse');
  };
  place('저항', 200); place('다이오드', 400);
  click(button('복사')!); key(svg, 'Escape');
  place('저항', 600);
  expect(saved().components.map(c => c.label)).toEqual(['R_1', 'D_1', 'R_2']);
  click(button('실행 취소')!);
  place('저항', 800);
  expect(saved().components.map(c => c.label)).toEqual(['R_1', 'D_1', 'R_2']);
});

it('routes every registered native drop through the same naming policy and ignores unknown kinds', () => {
  const svg = render(emptyDocument('drop-names'));
  const drop = (kind: string, x: number) => {
    const event = new MouseEvent('drop', { bubbles: true, clientX: x, clientY: 600 });
    Object.defineProperty(event, 'dataTransfer', { value: { getData: () => kind } });
    act(() => svg.dispatchEvent(event));
  };
  Object.keys(componentDefinitions).forEach((kind, i) => drop(kind, 100 + i * 160));
  expect(saved().components.map(c => c.label)).toEqual(['V_1', 'V_2', 'R_1', 'VR_1', 'S_1', 'S_2', 'A_1', 'M_1', 'D_1']);
  drop('toString', 1400); drop('unsupported', 1600);
  expect(saved().components).toHaveLength(9);
});

it('keeps one conditional copy button in the compact top toolbar and inserts a touch copy atomically', () => {
  const media = window.matchMedia.bind(window);
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
    const value = media(query);
    if (query === compactLayoutQuery) Object.defineProperty(value, 'matches', { value: true });
    return value;
  });
  const doc = fixture(),
    svg = render(doc);
  expect(button('복사')).toBeNull();
  expect(button('선택')?.closest('.editor-toolbar')).not.toBeNull();
  key(host.querySelector('[data-component-id="D"] .component')!, 'Enter');
  expect(host.querySelectorAll('button[aria-label="복사"]')).toHaveLength(1);
  expect(button('복사')?.closest('.editor-toolbar')).not.toBeNull();
  pointer(button('복사')!, 'pointerdown', 0, 0);
  click(button('복사')!);
  pointer(svg, 'pointerdown', 620, 400);
  pointer(svg, 'pointerup', 620, 400);
  click(svg, 620, 400);
  expect(host.querySelector('.copy-preview')).not.toBeNull();
  expect(saved()).toEqual(doc);
  key(svg, 'v', true);
  expect(saved()).toEqual(doc);
  click(host.querySelector('.copy-confirm-bubble .primary')!);
  const after = saved(),
    copy = after.components.find((c) => !doc.components.some((old) => old.id === c.id))!;
  expect(after.components).toHaveLength(4);
  // The existing insertion command merges the unanchored two-wire junction first.
  expect(after.wires).toHaveLength(2);
  for (const terminal of copy.terminals)
    expect(after.wires.some((w) => w.start.id === terminal.id || w.end.id === terminal.id)).toBe(
      true,
    );
  expect(copy.label).toBe('D_1');
  expect(after.components.find(c => c.id === doc.components[0].id)!.label).toBe('복사할 다이오드');
  expect(copy.properties).toEqual(doc.components[0].properties);
  expect(copy.operatingProfile).toEqual(doc.components[0].operatingProfile);
  expect(copy.position).toEqual({ x: 620, y: 400 });
  expect(host.querySelector('.copy-status')).toBeNull();
  expect(host.querySelector('.copy-preview')).toBeNull();
  click(button('실행 취소')!);
  expect(saved()).toEqual(doc);
  click(button('다시 실행')!);
  expect(saved()).toEqual(after);
});
it('copies a whole circuit with its junction and routes, keeps connections separate and undoes once', () => {
  const doc = fixture(),
    svg = render(doc);
  key(svg, 'a', true);
  key(svg, 'c', true);
  expect(saved()).toEqual(doc);
  pointer(svg, 'pointermove', 800, 700, 'mouse');
  pointer(svg, 'pointerdown', 800, 700, 'mouse');
  pointer(svg, 'pointerup', 800, 700, 'mouse');
  click(svg, 800, 700);
  const after = saved();
  expect(after.components).toHaveLength(6);
  expect(after.junctions).toHaveLength(2);
  expect(after.wires).toHaveLength(4);
  const junction = after.junctions.find((j) => j.id !== 'J')!;
  expect(after.wires[2].end.id).toBe(junction.id);
  expect(after.wires[3].start.id).toBe(junction.id);
  click(button('실행 취소')!);
  expect(saved()).toEqual(doc);
  key(svg, 'a', true);
  key(svg, 'Delete');
  expect(saved().components).toHaveLength(0);
  expect(saved().wires).toHaveLength(0);
});
it('keeps the preview and original document when activity permissions forbid copying into the circuit', () => {
  const doc = fixture();
  doc.activity = { allowedCommands: ['SetLabel'], revealSteps: [] };
  const svg = render(doc);
  key(svg, 'a', true);
  key(svg, 'c', true);
  pointer(svg, 'pointerdown', 800, 700, 'mouse');
  pointer(svg, 'pointerup', 800, 700, 'mouse');
  click(svg, 800, 700);
  expect(saved()).toEqual(doc);
  expect(button('실행 취소')?.disabled).toBe(true);
  expect(host.querySelector('.copy-status')?.textContent).toContain('붙여넣을 수 없어요');
  key(svg, 'Escape');
  expect(host.querySelector('.copy-status')).toBeNull();
  expect(button('복사')).toBeNull();
});
