// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CircuitCanvas, type CanvasProps } from '../src/app/CircuitCanvas';
import { layoutExample } from '../src/app/examples';
import { examples } from '../src/fixtures';
import { createComponent } from '../src/component-library';
import { createHistory, executeCommand } from '../src/editor';
import type { Point } from '../src/domain';

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // Layout is covered in the real browser. Here client coordinates map 1:1 to document coordinates.
  vi.stubGlobal('DOMPoint', class {
    constructor(public x: number, public y: number) {}
    matrixTransform() { return this; }
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function setup(overrides: Partial<CanvasProps> = {}) {
  const original = layoutExample(examples.find(e => e.document.documentId === 'fix-02')!.document);
  original.components.push(createComponent('resistor', 'R3', { x: 440, y: 400 }));
  let history = createHistory(original);
  const onMove = vi.fn((positions: Record<string, Point>) => {
    const result = executeCommand(history, { type: 'MoveComponents', positions });
    if (!result.ok) throw new Error('move failed');
    history = result.history;
    render({ document: history.present });
  });
  let props: CanvasProps = {
    document: history.present, selected: [], tool: 'select', placement: null, wireStart: null,
    onSelect: () => {}, onMove, onPlace: vi.fn(), onEndpoint: () => {}, onWire: () => {},
    onValue: () => {}, onSwitch: () => {}, onBackground: () => {}, ...overrides,
  };
  function render(changes: Partial<CanvasProps> = {}) {
    props = { ...props, ...changes };
    root.render(createElement(CircuitCanvas, props));
  }
  act(() => render());
  const svg = host.querySelector('svg')!;
  const captured = new Set<number>();
  Object.assign(svg, {
    getScreenCTM: () => ({ inverse: () => ({}) }),
    setPointerCapture: (id: number) => captured.add(id),
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: (id: number) => {
      captured.delete(id);
      svg.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: id }));
    },
  });
  const component = (id: string) => host.querySelector(`[aria-label^="${id} "].component`)!;
  const paths = () => [...host.querySelectorAll('polyline[aria-label^="도선 "]')].map(el => el.getAttribute('points'));
  function pointer(target: Element, type: string, x: number, y: number, pointerId = 1, pointerType = 'mouse') {
    act(() => { target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId, pointerType, button: 0 })); });
  }
  return { svg, component, paths, pointer, onMove, original, history: () => history, render: (changes: Partial<CanvasProps>) => act(() => render(changes)) };
}

describe('live canvas drag geometry', () => {
  it.each(['mouse', 'touch'])('keeps all existing routes throughout an unconnected R3 %s drag', pointerType => {
    const c = setup();
    const before = c.paths();
    c.pointer(c.component('R3'), 'pointerdown', 440, 400, 1, pointerType);
    for (const [x, y] of [[442, 403], [480, 420], [600, 500]]) {
      c.pointer(c.svg, 'pointermove', x, y, 1, pointerType);
      expect(c.paths()).toEqual(before);
      expect(c.onMove).not.toHaveBeenCalled();
    }
    c.pointer(c.svg, 'pointerup', 600, 500, 1, pointerType);
    expect(c.paths()).toEqual(before);
    expect(c.onMove).toHaveBeenCalledExactlyOnceWith({ R3: { x: 600, y: 500 } });
    expect(c.history().past).toHaveLength(1);
  });

  it('uses the same connected-wire geometry before and after release', () => {
    const c = setup();
    const before = c.paths();
    c.pointer(c.component('R2'), 'pointerdown', 660, 220);
    c.pointer(c.svg, 'pointermove', 700, 260);
    const preview = c.paths();
    expect(preview[0]).toEqual(before[0]);
    expect(preview[3]).not.toEqual(before[3]);
    c.pointer(c.svg, 'pointerup', 700, 260);
    expect(c.paths()).toEqual(preview);
  });

  it('does not invalidate a route for a sub-grid move or a return to the start', () => {
    const c = setup();
    const before = c.paths();
    c.pointer(c.component('R2'), 'pointerdown', 660, 220);
    c.pointer(c.svg, 'pointermove', 662, 222);
    expect(c.paths()).toEqual(before);
    c.pointer(c.svg, 'pointermove', 700, 260);
    expect(c.paths()).not.toEqual(before);
    c.pointer(c.svg, 'pointermove', 660, 220);
    expect(c.paths()).toEqual(before);
    c.pointer(c.svg, 'pointerup', 660, 220);
    expect(c.onMove).not.toHaveBeenCalled();
  });

  it.each(['pointercancel', 'lostpointercapture', 'Escape', 'blur'])('cancels the whole preview on %s without a late commit', cancellation => {
    const c = setup();
    const before = c.paths();
    c.pointer(c.component('R2'), 'pointerdown', 660, 220);
    c.pointer(c.svg, 'pointermove', 700, 260);
    expect(c.paths()).not.toEqual(before);
    if (cancellation === 'Escape') act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    else if (cancellation === 'blur') act(() => { window.dispatchEvent(new Event('blur')); });
    else c.pointer(c.svg, cancellation, 700, 260);
    expect(c.paths()).toEqual(before);
    c.pointer(c.svg, 'pointerup', 700, 260);
    expect(c.onMove).not.toHaveBeenCalled();
  });

  it('commits the release position even without a final pointermove', () => {
    const c = setup();
    c.pointer(c.component('R3'), 'pointerdown', 440, 400);
    c.pointer(c.svg, 'pointermove', 480, 420);
    c.pointer(c.svg, 'pointerup', 520, 460);
    expect(c.onMove).toHaveBeenCalledExactlyOnceWith({ R3: { x: 520, y: 460 } });
  });

  it('ignores another pointer while a drag owns capture', () => {
    const c = setup();
    c.pointer(c.component('R3'), 'pointerdown', 440, 400);
    c.pointer(c.svg, 'pointermove', 900, 700, 2, 'touch');
    c.pointer(c.svg, 'pointerup', 900, 700, 2, 'touch');
    expect(c.onMove).not.toHaveBeenCalled();
    c.pointer(c.svg, 'pointerup', 480, 440);
    expect(c.onMove).toHaveBeenCalledExactlyOnceWith({ R3: { x: 480, y: 440 } });
  });

  it.each(['document', 'tool', 'readOnly'])('invalidates stale movement when %s changes', change => {
    const c = setup();
    const before = c.paths();
    c.pointer(c.component('R2'), 'pointerdown', 660, 220);
    c.pointer(c.svg, 'pointermove', 700, 260);
    c.render(change === 'document' ? { document: structuredClone(c.original) } : change === 'tool' ? { tool: 'wire' } : { readOnly: true });
    expect(c.paths()).toEqual(before);
    c.pointer(c.svg, 'pointerup', 700, 260);
    expect(c.onMove).not.toHaveBeenCalled();
  });
});
