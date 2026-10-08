// @vitest-environment happy-dom
import { act, createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import * as q from '../src/rational';
import { analyze } from '../src/app/analyze';
import { meterReading, MeterReadouts, type MeterReadoutsHandle } from '../src/app/MeterReadouts';
import { createComponent } from '../src/component-library';
import { failedResult } from '../src/simulation';
import { meterCircuit } from './meter-fixture';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('reads signed live values through the common queries, preserving zero, tiny current and unavailable states', () => {
  const document = meterCircuit();
  const a = document.components.find((c) => c.id === 'A1')!;
  const v = document.components.find((c) => c.id === 'M1')!;
  const read = (suspended = false) => {
    const props = { document, ...analyze(document), suspended };
    return [meterReading(a, props).text, meterReading(v, props).text];
  };
  expect(read()).toEqual(['1 A', '3 V']);
  document.components.find((c) => c.id === 'V1')!.properties.voltageV = q.store(-9);
  expect(read()).toEqual(['-1 A', '-3 V']);
  document.components.find((c) => c.id === 'S1')!.properties.state = 'open';
  expect(read()).toEqual(['0 A', '0 V']);
  expect(read(true)).toEqual(['— A', '— V']);
  document.components.find((c) => c.id === 'S1')!.properties.state = 'closed';
  document.components.find((c) => c.id === 'R1')!.properties.resistanceOhm = q.store(9e9);
  expect(read()[0]).toBe('-1 nA');
  const props = { document, ...analyze(document), result: failedResult([]), suspended: false };
  expect(meterReading(a, props).text).toBe('— A');
  expect(meterReading(v, props).text).toBe('— V');
});

it('does not invent a voltage across independent references or floating terminals', () => {
  const document = meterCircuit();
  const meter = document.components.find((c) => c.id === 'M1')!;
  document.wires = document.wires.filter((w) => w.id !== 'M-b');
  expect(meterReading(meter, { document, ...analyze(document), suspended: false }).text).toBe(
    '— V',
  );
  const other = createComponent('dc-voltage-source', 'V2', { x: 800, y: 300 });
  document.components.push(other);
  document.wires.push({
    id: 'cross-reference',
    start: { kind: 'terminal', id: 'M1.b' },
    end: { kind: 'terminal', id: 'V2.b' },
    waypoints: [],
  });
  expect(meterReading(meter, { document, ...analyze(document), suspended: false }).text).toBe(
    '— V',
  );
});

it('retains formatting provenance and the component quantity format', () => {
  const document = meterCircuit(),
    a = document.components.find((c) => c.id === 'A1')!;
  const props = { document, ...analyze(document), suspended: false };
  props.result.branchCurrents.A1 = q.rational(1n, 1000n);
  a.properties.quantityMode = 'plain';
  expect(meterReading(a, props).text).toBe('0.001 A');
  props.result.provenance = { ...props.result.provenance!, physicalModel: 'component' };
  expect(meterReading(a, props).text).toBe('≈ 0.001 A');
});

it('tracks renderer anchors, bounds and multiple readouts without intercepting canvas actions', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(140);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(44);
  const doc = meterCircuit(),
    ref = createRef<MeterReadoutsHandle>(),
    onToggle = vi.fn(),
    background = vi.fn();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    act(() =>
      root.render(
        createElement(
          'div',
          { onClick: background, onPointerDown: background },
          createElement(MeterReadouts, {
            ref,
            document: doc,
            ...analyze(doc),
            suspended: false,
            openIds: new Set(['A1', 'M1']),
            onToggle,
          }),
        ),
      ),
    );
    act(() =>
      ref.current!.updateLayout({
        bounds: { x: 0, y: 0, width: 320, height: 200 },
        labels: [],
        obstacles: [],
        symbolAnchors: [
          { componentId: 'A1', x: 300, y: 60 },
          { componentId: 'M1', x: 300, y: 70 },
        ],
      }),
    );
    const a = host.querySelector<HTMLElement>('[data-meter-id="A1"]')!,
      v = host.querySelector<HTMLElement>('[data-meter-id="M1"]')!;
    expect(a.style.visibility).toBe('visible');
    expect(parseFloat(a.style.left) + 140).toBeLessThanOrEqual(320);
    expect(a.style.top).not.toBe(v.style.top);
    const toggle = a.querySelector('button')!;
    act(() => {
      toggle.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }),
      );
      toggle.click();
    });
    expect(background).not.toHaveBeenCalled();
    expect(onToggle).toHaveBeenCalledWith('A1');
    act(() =>
      ref.current!.updateLayout({
        bounds: { x: 0, y: 0, width: 320, height: 200 },
        labels: [],
        obstacles: [],
        symbolAnchors: [],
      }),
    );
    expect(a.style.visibility).toBe('hidden');
    expect(host.querySelectorAll('output')).toHaveLength(2); // Offscreen is not collapsed.
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
