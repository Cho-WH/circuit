import { requireDocument } from '../src/domain';
import * as q from '../src/rational';
// @vitest-environment happy-dom
import { act, createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CurrentControls, CurrentSettings, useCurrentDisplay } from '../src/app/CurrentControls';
import type { CircuitDocument } from '../src/domain';
import { buildCurrentModel, type CurrentDisplay, type CurrentModel } from '../src/visualization';
import { compileCircuit } from '../src/connectivity';
import { solveCircuit } from '../src/simulation';

let root: Root, host: HTMLDivElement, last: CurrentDisplay;
const doc = requireDocument(JSON.parse(readFileSync('fixtures/FIX-03-parallel.json', 'utf8'))
  .document) as CircuitDocument;
const compilation = compileCircuit(doc),
  model = buildCurrentModel(doc, compilation, solveCircuit(compilation.circuit));
function Harness({
  current = model,
  selectedId = 'V1',
}: {
  current?: CurrentModel;
  selectedId?: string;
}) {
  const { display, setPaused, setWidthScale } = useCurrentDisplay(current);
  last = display;
  return createElement(
    Fragment,
    null,
    createElement(CurrentControls, { paused: display.paused, onPause: setPaused }),
    createElement(CurrentSettings, {
      document: doc,
      display,
      selectedId,
      onWidthScale: setWidthScale,
    }),
  );
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const render = async (props: Parameters<typeof Harness>[0] = {}) =>
  act(async () => root.render(createElement(Harness, props)));
const click = async (text: string) =>
  act(async () =>
    [...host.querySelectorAll('button')]
      .find((b) => b.getAttribute('aria-label') === text)!
      .click(),
  );
describe('shared current controls', () => {
  it('automatically rescales edits while pause and thickness remain independent', async () => {
    await render();
    expect(last.scaleAmperes).toEqual(q.from(3));
    const input = host.querySelector('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '2');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(last.widthScale).toBe(2);
    await click('흐름 일시 정지');
    for (const maxMagnitude of [0, 1e-9, 6]) {
      await render({ current: { ...model, maxMagnitude } });
      if (maxMagnitude > 0) expect(q.toNumber(last.scaleAmperes)).toBe(maxMagnitude);
      else {
        expect(Number.isFinite(q.toNumber(last.scaleAmperes))).toBe(true);
        expect(q.sign(last.scaleAmperes)).toBeGreaterThan(0);
      }
      expect(last.widthScale).toBe(2);
      expect(last.paused).toBe(true);
    }
  });
  it('reports actual source direction and keeps unknown readings distinct from zero', async () => {
    await render();
    expect(host.querySelector('.current-readout')!.textContent).toContain('3 A');
    const direction = host.querySelector('.current-direction')!.textContent!;
    expect(direction.indexOf('−극')).toBeLessThan(direction.indexOf('＋극'));
    const unknown: CurrentModel = {
      samples: [{ id: 'W1', kind: 'wire', value: { status: 'undefined', diagnostics: [] } }],
      maxMagnitude: 0,
    };
    await render({ current: unknown, selectedId: 'W1' });
    expect(host.textContent).toContain('전류 미정');
    expect(host.querySelector('.current-direction')).toBeNull();
    const zero: CurrentModel = {
      ...model,
      samples: model.samples.map((s) =>
        s.id === 'V1'
          ? {
              ...s,
              value: {
                status: 'known',
                amperes: 0,
                from: { kind: 'terminal', id: 'V1.p' },
                to: { kind: 'terminal', id: 'V1.n' },
              },
            }
          : s,
      ),
    };
    await render({ current: zero });
    expect(host.querySelector('.current-readout')!.textContent).toContain('흐르는 전류 없음');
  });
});
